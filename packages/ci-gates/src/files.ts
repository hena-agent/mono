import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { parseSync } from "oxc-parser";

const gitExecutable = "/usr/bin/git";
const generatedTypeScriptPaths = new Set([".opencode/plugin/codex-web-search.ts"]);
const rootSourceBarrelPattern = /^(?:packages\/[^/]+\/)?src\/index\.(?:ts|tsx|mts|cts)$/u;

export interface SourceFile {
  readonly content: string;
  readonly path: string;
}

export interface SourceFileAccess {
  readonly listPaths: (cwd: string) => readonly string[];
  readonly readText: (path: string) => string;
}

export interface StaticScopeAccess {
  readonly listIgnoredPaths: (cwd: string, paths: readonly string[]) => readonly string[];
  readonly listPaths: (cwd: string) => readonly string[];
}

export const parseGitFileList = (output: string): readonly string[] =>
  output.split("\0").filter((path) => path !== "");

export const listGitFiles = (cwd: string, pathspecs: readonly string[] = []): readonly string[] =>
  parseGitFileList(
    execFileSync(
      gitExecutable,
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...pathspecs],
      { cwd, encoding: "utf8" },
    ),
  );

export const isRootSourceBarrel = (path: string): boolean => rootSourceBarrelPattern.test(path);

export const isDeclarativeRootBarrel = (path: string, content: string): boolean => {
  if (!isRootSourceBarrel(path)) return false;
  const result = parseSync(path, content);
  if (result.errors.length > 0 || result.program.body.length === 0) return false;
  return result.program.body.every(
    (statement) =>
      (statement.type === "ExportAllDeclaration" || statement.type === "ExportNamedDeclaration") &&
      statement.source !== null,
  );
};

export const liveSourceFileAccess: SourceFileAccess = {
  listPaths: (cwd) =>
    listGitFiles(cwd, [
      ":(glob)**/*.ts",
      ":(glob)**/*.tsx",
      ":(glob)**/*.mts",
      ":(glob)**/*.cts",
    ]).filter((path) => !generatedTypeScriptPaths.has(path)),
  readText: (path) => readFileSync(path, "utf8"),
};

const excludedStaticDirectories = new Set([
  ".stryker-tmp",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "reports",
]);

const liveStaticScopeAccess: StaticScopeAccess = {
  listIgnoredPaths: (cwd, paths) => {
    const result = spawnSync(gitExecutable, ["check-ignore", "-z", "--no-index", "--stdin"], {
      cwd,
      encoding: "utf8",
      input: paths.map((path) => `${path}\0`).join(""),
    });
    if (result.error !== undefined) {
      throw result.error;
    }
    if (result.status !== 0 && result.status !== 1) {
      throw new Error(`git check-ignore failed with status ${String(result.status)}`);
    }
    return parseGitFileList(result.stdout);
  },
  listPaths: liveSourceFileAccess.listPaths,
};

export const findExcludedTypeScriptFiles = (
  paths: readonly string[],
  ignoredPaths: readonly string[],
): readonly string[] => {
  const ignored = new Set(ignoredPaths);
  return paths.filter(
    (path) =>
      ignored.has(path) || path.split("/").some((part) => excludedStaticDirectories.has(part)),
  );
};

export const runStaticScopeGate = (
  cwd: string,
  access: StaticScopeAccess = liveStaticScopeAccess,
): number => {
  const paths = access.listPaths(cwd);
  const violations = findExcludedTypeScriptFiles(paths, access.listIgnoredPaths(cwd, paths));

  for (const path of violations) {
    console.error(`${path}: TypeScript is not permitted in a static-gate excluded directory`);
  }

  return violations.length === 0 ? 0 : 1;
};

export const readTypeScriptFiles = (
  cwd: string,
  access: SourceFileAccess = liveSourceFileAccess,
): readonly SourceFile[] =>
  access.listPaths(cwd).map((path) => ({
    content: access.readText(resolve(cwd, path)),
    path,
  }));
