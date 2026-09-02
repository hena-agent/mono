import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { isJson, isJsonObject, type Json, type JsonCandidate } from "@hena-dev/core";

import { listGitFiles } from "./files.ts";

export interface WorkspaceManifest {
  readonly exports: Json | undefined;
  readonly imports?: Json | undefined;
  readonly isTargetValid?: ((target: string) => boolean) | undefined;
  readonly path: string;
  readonly scripts: Readonly<Record<string, Json>> | undefined;
}

export interface WorkspaceManifestAccess {
  readonly listPaths: (cwd: string) => readonly string[];
  readonly listSymbolicLinkPaths: (cwd: string) => readonly string[];
  readonly isTargetValid: (manifestPath: string, target: string) => boolean;
  readonly readJson: (path: string) => JsonCandidate;
  readonly readRootJson: (cwd: string) => JsonCandidate;
}

export interface WorkspaceLayoutViolation {
  readonly message: string;
  readonly path: string;
}

export interface WorkspaceScriptViolation {
  readonly expected: string;
  readonly path: string;
  readonly script: string;
}

const requiredScripts = [
  ["build", "rm -rf dist && tsc -p tsconfig.build.json"],
  ["typecheck", "tsc --noEmit"],
  ["test", "vitest run --root . --config ../../vitest.config.mjs --coverage"],
  ["mutation", "stryker run"],
] as const;

const isLiveTargetValid = (manifestPath: string, target: string): boolean => {
  let isValid = false;
  try {
    const packagePath = dirname(manifestPath);
    const sourcePath = realpathSync(join(packagePath, "src"));
    const targetPath = resolve(packagePath, target);
    if (!lstatSync(targetPath).isFile()) return false;

    const targetRelativePath = relative(sourcePath, realpathSync(targetPath));
    isValid = targetRelativePath.split(sep)[0] !== ".." && !isAbsolute(targetRelativePath);
  } catch {}
  return isValid;
};

const liveWorkspaceManifestAccess: WorkspaceManifestAccess = {
  isTargetValid: isLiveTargetValid,
  listPaths: (cwd) =>
    readdirSync(join(cwd, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}/package.json`),
  listSymbolicLinkPaths: (cwd) =>
    listGitFiles(cwd).filter(
      (path) => path.startsWith("packages/") && lstatSync(resolve(cwd, path)).isSymbolicLink(),
    ),
  readJson: (path) => JSON.parse(readFileSync(path).toString("utf8")),
  readRootJson: (cwd) => JSON.parse(readFileSync(join(cwd, "package.json")).toString("utf8")),
};

const readWorkspaceManifests = (
  cwd: string,
  access: WorkspaceManifestAccess,
): readonly WorkspaceManifest[] =>
  [...access.listPaths(cwd)].map((path) => {
    const candidate = access.readJson(resolve(cwd, path));
    if (!isJson(candidate) || !isJsonObject(candidate)) {
      throw new TypeError(`${path}: package manifest must be a JSON object`);
    }

    const exports = candidate["exports"];
    const imports = candidate["imports"];
    const scripts = candidate["scripts"];
    if (scripts !== undefined && !isJsonObject(scripts)) {
      throw new TypeError(`${path}: scripts must be a JSON object`);
    }
    return {
      exports,
      imports,
      isTargetValid: (target: string) => access.isTargetValid(resolve(cwd, path), target),
      path,
      scripts,
    };
  });

const hasSourceExportTargets = (
  value: Json | undefined,
  isTargetValid: (target: string) => boolean = () => true,
): boolean => {
  if (typeof value === "string") {
    if (!value.startsWith("./")) return false;
    const segments = value.slice(2).split("/");
    return (
      !value.includes("\\") &&
      !/%2e/iu.test(value) &&
      segments[0] === "src" &&
      !segments.some((segment) => segment === "" || segment === "." || segment === "..") &&
      !value.includes("*") &&
      /\.(?:ts|tsx|mts|cts)$/u.test(value) &&
      !/\.(?:test|test-d)\.(?:ts|tsx|mts|cts)$/u.test(value) &&
      isTargetValid(value)
    );
  }
  if (!isJsonObject(value)) {
    return false;
  }
  const targets = Object.entries(value);
  return (
    targets.length > 0 &&
    targets.every(
      ([key, target]) => !key.includes("*") && hasSourceExportTargets(target, isTargetValid),
    )
  );
};

export const findWorkspaceLayoutViolations = (
  rootManifest: Readonly<Record<string, Json>>,
  manifests: readonly WorkspaceManifest[],
  symbolicLinkPaths: readonly string[] = [],
): readonly WorkspaceLayoutViolation[] => {
  const workspaces = rootManifest["workspaces"];
  const violations: WorkspaceLayoutViolation[] = [];
  if (!Array.isArray(workspaces) || workspaces.length !== 1 || workspaces[0] !== "packages/*") {
    violations.push({ message: 'workspaces must equal ["packages/*"]', path: "package.json" });
  }
  for (const path of symbolicLinkPaths) {
    violations.push({ message: "workspace symlinks are not permitted", path });
  }

  for (const manifest of manifests) {
    if (!hasSourceExportTargets(manifest.exports, manifest.isTargetValid)) {
      violations.push({
        message: "all package export targets must resolve under ./src/",
        path: manifest.path,
      });
    }
    if (
      manifest.imports !== undefined &&
      !hasSourceExportTargets(manifest.imports, manifest.isTargetValid)
    ) {
      violations.push({
        message: "all package import targets must resolve to non-test TypeScript under ./src/",
        path: manifest.path,
      });
    }
  }
  return violations;
};

export const findWorkspaceScriptViolations = (
  manifests: readonly WorkspaceManifest[],
): readonly WorkspaceScriptViolation[] =>
  [...manifests]
    .sort((left, right) => left.path.localeCompare(right.path))
    .flatMap((manifest) =>
      requiredScripts
        .filter(([script, expected]) => manifest.scripts?.[script] !== expected)
        .map(([script, expected]) => ({ expected, path: manifest.path, script })),
    );

export const runWorkspaceScriptGate = (
  cwd: string,
  access: WorkspaceManifestAccess = liveWorkspaceManifestAccess,
): number => {
  const rootCandidate = access.readRootJson(cwd);
  if (!isJson(rootCandidate) || !isJsonObject(rootCandidate)) {
    throw new TypeError("package.json: root manifest must be a JSON object");
  }
  const manifests = readWorkspaceManifests(cwd, access);
  const violations = findWorkspaceScriptViolations(manifests);
  const layoutViolations = findWorkspaceLayoutViolations(
    rootCandidate,
    manifests,
    access.listSymbolicLinkPaths(cwd),
  );

  for (const violation of violations) {
    console.error(
      `${violation.path}: required script "${violation.script}" must equal "${violation.expected}"`,
    );
  }

  for (const violation of layoutViolations) {
    console.error(`${violation.path}: ${violation.message}`);
  }

  return violations.length === 0 && layoutViolations.length === 0 ? 0 : 1;
};
