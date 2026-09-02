import { posix, resolve } from "node:path";

import {
  parseSync,
  Visitor,
  type MemberExpression,
  type Program,
  type VariableDeclarator,
} from "oxc-parser";
import { parseConfigFileTextToJson } from "typescript";

import type { JsonCandidate } from "@hena-dev/core";

import {
  isDeclarativeRootBarrel,
  isRootSourceBarrel,
  listGitFiles,
  liveSourceFileAccess,
  readTypeScriptFiles,
  type SourceFileAccess,
} from "./files.ts";

const packageSourcePattern = /^(packages\/[^/]+\/src)\//u;
const testSourcePattern = /\.(?:test|test-d)\.(?:ts|tsx|mts|cts)$/u;
const testReferencePattern = /\.(?:test|test-d)\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/u;
const relativePathPattern = /^\.{1,2}(?:\/|$)/u;
const localExtendsPattern = /^\.{1,2}(?:[\\/]|$)/u;
const typeScriptConfigPattern = /(?:^|\/)tsconfig[^/]*\.jsonc?$/u;
const remappingOptions = ["baseUrl", "paths", "rootDirs", "moduleSuffixes"] as const;

export interface ProductionScopeViolation {
  readonly message: string;
  readonly path: string;
}

export interface ProductionScopeAccess extends SourceFileAccess {
  readonly listTypeScriptConfigPaths: (cwd: string) => readonly string[];
}

const isCandidateObject = (
  value: JsonCandidate,
): value is Readonly<Record<string, JsonCandidate>> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const normalizedExtendedConfigPath = (path: string, extended: string): string =>
  posix.normalize(posix.join(posix.dirname(path), extended.replaceAll("\\", "/")));

const isRepositoryLocalExtends = (path: string, extended: string): boolean => {
  if (!localExtendsPattern.test(extended)) return false;
  const normalized = normalizedExtendedConfigPath(path, extended);
  return normalized !== ".." && !normalized.startsWith("../") && !posix.isAbsolute(normalized);
};

const hasExternalExtends = (path: string, value: JsonCandidate): boolean =>
  (typeof value === "string" && !isRepositoryLocalExtends(path, value)) ||
  (Array.isArray(value) &&
    value.some((entry) => typeof entry === "string" && !isRepositoryLocalExtends(path, entry)));

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
  if (hasExternalExtends(path, config["extends"])) {
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
  if (node.init?.type !== "Identifier" || node.init.name !== "process") return false;
  if (node.id.type !== "ObjectPattern") return false;
  return node.id.properties.some((property) => {
    if (property.type !== "Property") return false;
    // Stryker disable next-line all: OXC exposes name only on Identifier keys.
    if (property.key.type === "Identifier") {
      return property.key.name === "getBuiltinModule";
    }
    // Stryker disable next-line all: OXC exposes value only on Literal keys.
    if (property.key.type === "Literal") {
      return property.key.value === "getBuiltinModule";
    }
    return false;
  });
};

const hasBuiltinModuleMemberName = (node: MemberExpression): boolean => {
  // Stryker disable next-line all: OXC exposes name only on Identifier properties.
  if (node.property.type === "Identifier") {
    return node.property.name === "getBuiltinModule";
  }
  // Stryker disable next-line all: OXC exposes value only on Literal properties.
  if (node.property.type === "Literal") {
    return node.property.value === "getBuiltinModule";
  }
  return false;
};

const countCommonJsLoaders = (program: Program): number => {
  let count = 0;
  new Visitor({
    CallExpression: (node) => {
      // Stryker disable next-line all: OXC exposes name only on Identifier callees.
      if (node.callee.type !== "Identifier") return;
      if (node.callee.name === "require") count += 1;
    },
    VariableDeclarator: (node) => {
      count += Number(hasDestructuredProcessBuiltinLoader(node));
    },
    TSExternalModuleReference: () => {
      count += 1;
    },
    MemberExpression: (node) => {
      // Stryker disable next-line all: OXC exposes name only on Identifier objects.
      if (node.object.type !== "Identifier") return;
      if (node.object.name === "process" && hasBuiltinModuleMemberName(node)) {
        count += 1;
      }
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
    if (isRootSourceBarrel(path) && !isDeclarativeRootBarrel(path, content)) {
      violations.push({ message: "package source barrels may contain only re-exports", path });
    }
    return violations;
  });

const localConfigExtends = (path: string, content: string): readonly string[] => {
  const parsed = parseConfigFileTextToJson(path, content);
  const config = parsed.config as Readonly<Record<string, JsonCandidate>>;
  const extended = config["extends"];
  if (typeof extended === "string")
    return isRepositoryLocalExtends(path, extended) ? [extended] : [];
  return Array.isArray(extended)
    ? extended.filter(
        (entry): entry is string =>
          typeof entry === "string" && isRepositoryLocalExtends(path, entry),
      )
    : [];
};

const resolveExtendedConfigPath = (path: string, extended: string): string => {
  const normalized = normalizedExtendedConfigPath(path, extended);
  return /\.jsonc?$/u.test(normalized) ? normalized : `${normalized}.json`;
};

const readTypeScriptConfigs = (
  cwd: string,
  access: ProductionScopeAccess,
): readonly { readonly content: string; readonly path: string }[] => {
  const pending = [...access.listTypeScriptConfigPaths(cwd)];
  const seen = new Set<string>();
  const configs: { content: string; path: string }[] = [];
  while (pending.length > 0) {
    const path = pending.shift()!;
    if (seen.has(path)) continue;
    seen.add(path);
    const content = access.readText(resolve(cwd, path));
    configs.push({ content, path });
    pending.push(
      ...localConfigExtends(path, content).map((entry) => resolveExtendedConfigPath(path, entry)),
    );
  }
  return configs;
};

const liveProductionScopeAccess: ProductionScopeAccess = {
  ...liveSourceFileAccess,
  listTypeScriptConfigPaths: (cwd) =>
    listGitFiles(cwd).filter((path) => typeScriptConfigPattern.test(path)),
};

export const runProductionScopeGate = (
  cwd: string = process.cwd(),
  access: ProductionScopeAccess = liveProductionScopeAccess,
): number => {
  const violations = [
    ...findProductionScopeViolations(readTypeScriptFiles(cwd, access)),
    ...findTypeScriptRemappingViolations(readTypeScriptConfigs(cwd, access)),
  ];
  for (const violation of violations) console.error(`${violation.path}: ${violation.message}`);
  return violations.length === 0 ? 0 : 1;
};
