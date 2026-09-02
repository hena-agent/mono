import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  findWorkspaceLayoutViolations,
  findWorkspaceScriptViolations,
  runWorkspaceScriptGate,
  type WorkspaceManifest,
  type WorkspaceManifestAccess,
} from "./workspaces.ts";

const completeScripts = {
  build: "rm -rf dist && tsc -p tsconfig.build.json",
  mutation: "stryker run",
  test: "vitest run --root . --config ../../vitest.config.mjs --coverage",
  typecheck: "tsc --noEmit",
} as const;
const sourceExports = { ".": "./src/index.ts" } as const;
const rootManifest = { workspaces: ["packages/*"] } as const;

describe("findWorkspaceScriptViolations", () => {
  it("accepts complete manifests and extra scripts", () => {
    expect(
      findWorkspaceScriptViolations([
        {
          exports: sourceExports,
          path: "packages/core/package.json",
          scripts: { ...completeScripts, dev: "vite" },
        },
      ]),
    ).toEqual([]);
  });

  it("reports missing and incorrect scripts in deterministic order", () => {
    const manifests: readonly WorkspaceManifest[] = [
      { exports: undefined, path: "packages/z/package.json", scripts: undefined },
      {
        exports: undefined,
        path: "packages/a/package.json",
        scripts: { ...completeScripts, build: " ", mutation: false },
      },
    ];

    expect(findWorkspaceScriptViolations(manifests)).toEqual([
      {
        expected: "rm -rf dist && tsc -p tsconfig.build.json",
        path: "packages/a/package.json",
        script: "build",
      },
      { expected: "stryker run", path: "packages/a/package.json", script: "mutation" },
      {
        expected: "rm -rf dist && tsc -p tsconfig.build.json",
        path: "packages/z/package.json",
        script: "build",
      },
      { expected: "tsc --noEmit", path: "packages/z/package.json", script: "typecheck" },
      {
        expected: "vitest run --root . --config ../../vitest.config.mjs --coverage",
        path: "packages/z/package.json",
        script: "test",
      },
      { expected: "stryker run", path: "packages/z/package.json", script: "mutation" },
    ]);
  });
});

describe("findWorkspaceLayoutViolations", () => {
  it("accepts the fixed workspace root and nested source exports", () => {
    expect(
      findWorkspaceLayoutViolations(rootManifest, [
        {
          exports: {
            ".": { import: "./src/index.ts", types: "./src/index.ts" },
            "./suffixed": "./src/value.test.ts.ts",
          },
          path: "packages/core/package.json",
          scripts: undefined,
        },
      ]),
    ).toEqual([]);
  });

  it.each([
    ["backslash", "./src\\index.ts"],
    ["raw parent segment", "./src/nested/../index.ts"],
    ["raw current segment", "./src/./index.ts"],
    ["repeated separator", "./src//index.ts"],
    ["encoded dot segments", "./src/%2e%2E/index.ts"],
    ["deceptive non-relative prefix", "xxsrc/index.ts"],
  ])("rejects %s export and import targets", (_description, target) => {
    expect(
      findWorkspaceLayoutViolations(rootManifest, [
        {
          exports: { ".": target },
          imports: { "#value": target },
          path: "packages/core/package.json",
          scripts: undefined,
        },
      ]),
    ).toEqual([
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/core/package.json",
      },
      {
        message: "all package import targets must resolve to non-test TypeScript under ./src/",
        path: "packages/core/package.json",
      },
    ]);
  });

  it("uses target-validity evidence for every configured target", () => {
    const isTargetValid = vi.fn((target: string) => target !== "./src/missing.ts");
    expect(
      findWorkspaceLayoutViolations(rootManifest, [
        {
          exports: {
            ".": { import: "./src/index.ts", types: "./src/index.ts" },
            "./missing": "./src/missing.ts",
          },
          isTargetValid,
          path: "packages/core/package.json",
          scripts: undefined,
        },
      ]),
    ).toEqual([
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/core/package.json",
      },
    ]);
    expect(isTargetValid).toHaveBeenCalledWith("./src/index.ts");
    expect(isTargetValid).toHaveBeenCalledWith("./src/missing.ts");
  });

  it("rejects alternate workspaces and non-source exports", () => {
    expect(
      findWorkspaceLayoutViolations({ workspaces: ["packages/*", "extensions/*"] }, [
        {
          exports: { ".": "./lib/index.ts" },
          path: "packages/core/package.json",
          scripts: undefined,
        },
        { exports: {}, path: "packages/empty-object/package.json", scripts: undefined },
        { exports: [], path: "packages/empty/package.json", scripts: undefined },
        { exports: null, path: "packages/null/package.json", scripts: undefined },
        {
          exports: { ".": "./src/index.ts", "./bad": "./lib/bad.ts" },
          path: "packages/partial/package.json",
          scripts: undefined,
        },
        { exports: undefined, path: "packages/missing/package.json", scripts: undefined },
      ]),
    ).toEqual([
      { message: 'workspaces must equal ["packages/*"]', path: "package.json" },
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/core/package.json",
      },
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/empty-object/package.json",
      },
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/empty/package.json",
      },
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/null/package.json",
      },
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/partial/package.json",
      },
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/missing/package.json",
      },
    ]);
  });

  it("rejects normalized escapes and test files as production exports", () => {
    expect(
      findWorkspaceLayoutViolations(rootManifest, [
        {
          exports: { ".": "./src/../dist/index.js" },
          path: "packages/escape/package.json",
          scripts: undefined,
        },
        {
          exports: { ".": "./src/hidden.test.ts" },
          path: "packages/test/package.json",
          scripts: undefined,
        },
        {
          exports: { ".": "src/index.ts" },
          path: "packages/nonrelative/package.json",
          scripts: undefined,
        },
        {
          exports: { ".": "./src/uncovered.js" },
          path: "packages/javascript/package.json",
          scripts: undefined,
        },
        {
          exports: { ".": "./src/file.ts.extra" },
          path: "packages/suffixed/package.json",
          scripts: undefined,
        },
        {
          exports: { ".": "./src/index.ts" },
          imports: { "#hidden": "./src/hidden.test.ts" },
          path: "packages/alias/package.json",
          scripts: undefined,
        },
        {
          exports: { "./*": "./src/*.ts" },
          imports: { "#internal/*": "./src/*.ts" },
          path: "packages/wildcard/package.json",
          scripts: undefined,
        },
      ]),
    ).toEqual([
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/escape/package.json",
      },
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/test/package.json",
      },
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/nonrelative/package.json",
      },
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/javascript/package.json",
      },
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/suffixed/package.json",
      },
      {
        message: "all package import targets must resolve to non-test TypeScript under ./src/",
        path: "packages/alias/package.json",
      },
      {
        message: "all package export targets must resolve under ./src/",
        path: "packages/wildcard/package.json",
      },
      {
        message: "all package import targets must resolve to non-test TypeScript under ./src/",
        path: "packages/wildcard/package.json",
      },
    ]);
  });

  it("rejects symlinked workspace packages", () => {
    expect(findWorkspaceLayoutViolations(rootManifest, [], ["packages/linked"])).toEqual([
      {
        message: "workspace symlinks are not permitted",
        path: "packages/linked",
      },
    ]);
  });
});

describe("runWorkspaceScriptGate", () => {
  const manifestAccess = (
    manifest: ReturnType<WorkspaceManifestAccess["readJson"]>,
    root: ReturnType<WorkspaceManifestAccess["readRootJson"]> = rootManifest,
  ): WorkspaceManifestAccess => ({
    isTargetValid: () => true,
    listPaths: () => ["packages/core/package.json"],
    listSymbolicLinkPaths: () => [],
    readJson: () => manifest,
    readRootJson: () => root,
  });

  it("passes complete manifests", () => {
    expect(
      runWorkspaceScriptGate(
        "/repo",
        manifestAccess({
          exports: sourceExports,
          imports: { "#value": "./src/value.ts" },
          scripts: completeScripts,
        }),
      ),
    ).toBe(0);
  });

  it("prints every violation and fails", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(runWorkspaceScriptGate("/repo", manifestAccess({ exports: sourceExports }))).toBe(1);
    expect(error).toHaveBeenCalledTimes(4);
    expect(error).toHaveBeenCalledWith(
      'packages/core/package.json: required script "build" must equal "rm -rf dist && tsc -p tsconfig.build.json"',
    );
    error.mockRestore();
  });

  it("sorts adapter-provided manifests before reporting violations", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const access: WorkspaceManifestAccess = {
      isTargetValid: () => true,
      listPaths: () => ["packages/z/package.json", "packages/a/package.json"],
      listSymbolicLinkPaths: () => [],
      readJson: () => ({ exports: sourceExports }),
      readRootJson: () => rootManifest,
    };

    expect(runWorkspaceScriptGate("/repo", access)).toBe(1);
    expect(error.mock.calls[0]?.[0]).toContain("packages/a/package.json");
    error.mockRestore();
  });

  it("prints workspace layout violations", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      runWorkspaceScriptGate(
        "/repo",
        manifestAccess(
          { exports: { ".": "./lib/index.ts" }, scripts: completeScripts },
          { workspaces: ["extensions/*"] },
        ),
      ),
    ).toBe(1);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith('package.json: workspaces must equal ["packages/*"]');
    expect(
      runWorkspaceScriptGate(
        "/repo",
        manifestAccess({
          exports: sourceExports,
          imports: { "#hidden": "./src/hidden.test.ts" },
          scripts: completeScripts,
        }),
      ),
    ).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "packages/core/package.json: all package import targets must resolve to non-test TypeScript under ./src/",
    );
    error.mockRestore();
  });

  it("reports missing exports with and without scripts", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(runWorkspaceScriptGate("/repo", manifestAccess({ scripts: completeScripts }))).toBe(1);
    expect(runWorkspaceScriptGate("/repo", manifestAccess({}))).toBe(1);
    expect(
      error.mock.calls.filter(
        ([message]) =>
          message ===
          "packages/core/package.json: all package export targets must resolve under ./src/",
      ),
    ).toHaveLength(2);
    error.mockRestore();
  });

  it("rejects invalid manifest roots", () => {
    expect(() => runWorkspaceScriptGate("/repo", manifestAccess([]))).toThrow(
      "packages/core/package.json: package manifest must be a JSON object",
    );
    expect(() => runWorkspaceScriptGate("/repo", manifestAccess(undefined))).toThrow(
      "packages/core/package.json: package manifest must be a JSON object",
    );
    expect(() => runWorkspaceScriptGate("/repo", manifestAccess(null))).toThrow(
      "packages/core/package.json: package manifest must be a JSON object",
    );
    expect(() => runWorkspaceScriptGate("/repo", manifestAccess("manifest"))).toThrow(
      "packages/core/package.json: package manifest must be a JSON object",
    );
  });

  it("rejects a non-object scripts field", () => {
    expect(() => runWorkspaceScriptGate("/repo", manifestAccess({ scripts: [] }))).toThrow(
      "packages/core/package.json: scripts must be a JSON object",
    );
  });

  it("rejects an invalid root manifest", () => {
    expect(() => runWorkspaceScriptGate("/repo", manifestAccess({}, []))).toThrow(
      "package.json: root manifest must be a JSON object",
    );
  });

  it("discovers only package directories in sorted order", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hena-workspaces-"));
    const firstPackage = join(cwd, "packages", "a");
    const secondPackage = join(cwd, "packages", "z");
    mkdirSync(firstPackage, { recursive: true });
    mkdirSync(secondPackage, { recursive: true });
    writeFileSync(join(cwd, "packages", "not-a-package"), "ignored");
    writeFileSync(join(cwd, "package.json"), JSON.stringify(rootManifest));
    writeFileSync(join(firstPackage, "package.json"), JSON.stringify({ exports: sourceExports }));
    writeFileSync(join(secondPackage, "package.json"), JSON.stringify({ exports: sourceExports }));
    mkdirSync(join(firstPackage, "src"));
    mkdirSync(join(secondPackage, "src"));
    writeFileSync(join(firstPackage, "src", "index.ts"), "export {};");
    writeFileSync(join(secondPackage, "src", "index.ts"), "export {};");
    writeFileSync(join(firstPackage, "src", "hidden.test.ts"), "export const hidden = 1;");
    symlinkSync(
      join(firstPackage, "src", "hidden.test.ts"),
      join(firstPackage, "src", "public.ts"),
    );
    symlinkSync(firstPackage, join(cwd, "packages", "linked"), "dir");
    symlinkSync(firstPackage, join(cwd, "linked-root"), "dir");
    execFileSync("/usr/bin/git", ["init", "--quiet"], { cwd });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(runWorkspaceScriptGate(cwd)).toBe(1);
      expect(error).toHaveBeenCalledTimes(10);
      expect(error.mock.calls[0]?.[0]).toContain("packages/a/package.json");
      expect(error.mock.calls[4]?.[0]).toContain("packages/z/package.json");
      expect(error).toHaveBeenCalledWith("packages/linked: workspace symlinks are not permitted");
      expect(error).toHaveBeenCalledWith(
        "packages/a/src/public.ts: workspace symlinks are not permitted",
      );
    } finally {
      error.mockRestore();
      rmSync(cwd, { force: true, recursive: true });
    }
  });

  it("rejects missing, symlinked, and real-path escaping targets", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hena-workspace-targets-"));
    const packagePath = join(cwd, "packages", "core");
    const sourcePath = join(packagePath, "src");
    const outsidePath = join(packagePath, "outside");
    mkdirSync(sourcePath, { recursive: true });
    mkdirSync(outsidePath);
    writeFileSync(join(cwd, "package.json"), JSON.stringify(rootManifest));
    writeFileSync(join(sourcePath, "index.ts"), "export {};");
    writeFileSync(join(outsidePath, "index.ts"), "export {};");
    writeFileSync(
      join(cwd, ".gitignore"),
      "packages/core/src/final.ts\npackages/core/src/nested\n",
    );
    symlinkSync(join(sourcePath, "index.ts"), join(sourcePath, "final.ts"));
    symlinkSync(outsidePath, join(sourcePath, "nested"), "dir");
    execFileSync("/usr/bin/git", ["init", "--quiet"], { cwd });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const writeManifest = (target: string): void =>
      writeFileSync(
        join(packagePath, "package.json"),
        JSON.stringify({ exports: { ".": target }, scripts: completeScripts }),
      );

    try {
      writeManifest("./src/index.ts");
      expect(runWorkspaceScriptGate(cwd)).toBe(0);
      for (const target of ["./src/missing.ts", "./src/final.ts", "./src/nested/index.ts"]) {
        writeManifest(target);
        expect(runWorkspaceScriptGate(cwd)).toBe(1);
      }
      expect(error).toHaveBeenCalledTimes(3);
      expect(error).toHaveBeenLastCalledWith(
        "packages/core/package.json: all package export targets must resolve under ./src/",
      );
    } finally {
      error.mockRestore();
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});
