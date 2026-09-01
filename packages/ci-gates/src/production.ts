import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix, resolve } from "node:path";

import { parseSync, Visitor, type Program, type VariableDeclarator } from "oxc-parser";
import { parseConfigFileTextToJson } from "typescript";

import type { JsonCandidate } from "@hena-dev/core";

import { parseGitFileList, readTypeScriptFiles, type SourceFileAccess } from "./files.ts";

const gitExecutable = "/usr/bin/git";

const packageSourcePattern = /^(packages\/[^/]+\/src)\//u;
const testSourcePattern = /\.(?:test|test-d)\.(?:ts|tsx|mts|cts)$/u;
const testReferencePattern = /\.(?:test|test-d)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u;
const barrelPathPattern = /\/src\/index\.(?:ts|tsx|mts|cts)$/u;
const barrelExportPattern = /export\s+(?:type\s+)?(?:\*|\{[^}]*\})\s+from\s+["'][^"']+["'];?/gu;
const relativePathPattern = /^\.{1,2}(?:\/|$)/u;
const localExtendsPattern = /^\.{1,2}(?:[\\/]|$)/u;
const remappingOptions = ["baseUrl", "paths", "rootDirs", "moduleSuffixes"] as const;

export interface ProductionScopeViolation {
  readonly message: string;
  readonly path: string;
}

const isCandidateObject = (
  value: JsonCandidate,
): value is Readonly<Record<string, JsonCandidate>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const hasExternalExtends = (value: JsonCandidate): boolean =>
  (typeof value === "string" && !localExtendsPattern.test(value)) ||
  (Array.isArray(value) &&
    value.some((entry) => typeof entry === "string" && !localExtendsPattern.test(entry)));

const findTypeScriptConfigViolations = (
  path: string,
  content: string,
): readonly ProductionScopeViolation[] => {
  const parsed = parseConfigFileTextToJson(path, content);
  const config = parsed.config as JsonCandidate;
  if (parsed.error !== undefined || !isCandidateObject(config)) {
    return [{ message: "TypeScript config must parse without errors", path }];
  }
  const compilerOptions = config["compilerOptions"];
  const violations: ProductionScopeViolation[] = [];
  if (
    isCandidateObject(compilerOptions) &&
    remappingOptions.some((option) => Object.hasOwn(compilerOptions, option))
  ) {
    violations.push({
      message: "TypeScript baseUrl/paths/rootDirs/moduleSuffixes remapping is not permitted",
      path,
    });
  }
  if (hasExternalExtends(config["extends"])) {
    violations.push({ message: "external TypeScript config extends are not permitted", path });
  }
  return violations;
};

export const findTypeScriptRemappingViolations = (
  configs: readonly { readonly content: string; readonly path: string }[],
): readonly ProductionScopeViolation[] =>
  configs.flatMap(({ content, path }) => findTypeScriptConfigViolations(path, content));

const escapesPackageSource = (path: string, sourceRoot: string, specifier: string): boolean => {
  const normalizedSpecifier = specifier.replaceAll("\\", "/");
  if (!relativePathPattern.test(normalizedSpecifier)) return false;
  const target = posix.normalize(posix.join(posix.dirname(path), normalizedSpecifier));
  return target !== sourceRoot && !target.startsWith(`${sourceRoot}/`);
};

const hasDestructuredProcessBuiltinLoader = (node: VariableDeclarator): boolean => {
  if (node.init === null || Reflect.get(node.init, "name") !== "process") return false;
  if (node.id.type !== "ObjectPattern") return false;
  return node.id.properties.some(
    (property) =>
      property.type === "Property" &&
      (Reflect.get(property.key, "name") ?? Reflect.get(property.key, "value")) ===
        "getBuiltinModule",
  );
};

const countCommonJsLoaders = (program: Program): number => {
  let count = 0;
  new Visitor({
    Identifier: (node) => {
      if (node.name === "require") count += 1;
    },
    VariableDeclarator: (node) => {
      count += Number(hasDestructuredProcessBuiltinLoader(node));
    },
    TSExternalModuleReference: () => {
      count += 1;
    },
    MemberExpression: (node) => {
      const objectName: JsonCandidate = Reflect.get(node.object, "name");
      const propertyName: JsonCandidate =
        Reflect.get(node.property, "name") ?? Reflect.get(node.property, "value");
      if (objectName === "process" && propertyName === "getBuiltinModule") count += 1;
    },
  }).visit(program);
  return count;
};

export const findProductionScopeViolations = (
  files: readonly { readonly content: string; readonly path: string }[],
): readonly ProductionScopeViolation[] =>
  files.flatMap(({ content, path }) => {
    const sourceRoot = packageSourcePattern.exec(path)?.[1];
    if (sourceRoot === undefined || testSourcePattern.test(path)) return [];
    const parsed = parseSync(path, content);
    if (parsed.errors.length > 0) {
      return [{ message: "production source must parse without errors", path }];
    }
    const specifiers = new Set([
      ...parsed.module.staticImports.map((entry) => entry.moduleRequest.value),
      ...parsed.module.staticExports
        .flatMap((entry) => entry.entries)
        .map((entry) => entry.moduleRequest)
        .filter((request) => request !== null)
        .map((request) => request.value),
    ]);
    const commonJsLoaderCount = countCommonJsLoaders(parsed.program);
    const violations = [...specifiers]
      .filter((specifier) => testReferencePattern.test(specifier))
      .map((specifier) => ({
        message: `production source references test module ${specifier}`,
        path,
      }));
    violations.push(
      ...[...specifiers]
        .filter((specifier) => escapesPackageSource(path, sourceRoot, specifier))
        .map((specifier) => ({
          message: `production source references module outside package src ${specifier}`,
          path,
        })),
      ...[...specifiers]
        .filter((specifier) => specifier === "module" || specifier === "node:module")
        .map(() => ({ message: "CommonJS loaders are not permitted in production source", path })),
      ...Array.from({ length: commonJsLoaderCount }, () => ({
        message: "CommonJS loaders are not permitted in production source",
        path,
      })),
      ...parsed.module.dynamicImports.map(() => ({
        message: "dynamic imports are not permitted in production source",
        path,
      })),
    );
    if (barrelPathPattern.test(path) && content.replace(barrelExportPattern, "").trim() !== "") {
      violations.push({ message: "package source barrels may contain only re-exports", path });
    }
    return violations;
  });

const readTypeScriptConfigs = (
  cwd: string,
): readonly { readonly content: string; readonly path: string }[] =>
  parseGitFileList(
    execFileSync(
      gitExecutable,
      [
        "ls-files",
        "-z",
        "--cached",
        "--others",
        "--exclude-standard",
        "--",
        ":(glob)**/*.json",
        ":(glob)**/*.jsonc",
      ],
      { cwd, encoding: "utf8" },
    ),
  ).map((path) => ({ content: readFileSync(resolve(cwd, path), "utf8"), path }));

export const runProductionScopeGate = (
  cwd: string = process.cwd(),
  access?: SourceFileAccess,
): number => {
  const violations = [
    ...findProductionScopeViolations(readTypeScriptFiles(cwd, access)),
    ...findTypeScriptRemappingViolations(access === undefined ? readTypeScriptConfigs(cwd) : []),
  ];
  for (const violation of violations) console.error(`${violation.path}: ${violation.message}`);
  return violations.length === 0 ? 0 : 1;
};
