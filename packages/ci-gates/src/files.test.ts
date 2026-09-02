import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(() => "src/live.ts\0.opencode/plugin/codex-web-search.ts\0"),
  spawnSync: vi.fn(() => ({ status: 1, stdout: "" })),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "live contents"),
}));

import {
  findExcludedTypeScriptFiles,
  isDeclarativeRootBarrel,
  isRootSourceBarrel,
  listGitFiles,
  parseGitFileList,
  readTypeScriptFiles,
  runStaticScopeGate,
  type SourceFileAccess,
  type StaticScopeAccess,
} from "./files.ts";

describe("parseGitFileList", () => {
  it("parses paths", () => {
    expect(parseGitFileList("a.ts\0b.tsx\0c.mts\0d.cts\0")).toEqual([
      "a.ts",
      "b.tsx",
      "c.mts",
      "d.cts",
    ]);
  });

  it("handles an empty result and preserves newlines in paths", () => {
    expect(parseGitFileList("")).toEqual([]);
    expect(parseGitFileList("line\nbreak.ts\0")).toEqual(["line\nbreak.ts"]);
  });
});

it("discovers requested Git paths", () => {
  vi.mocked(execFileSync).mockReturnValueOnce("a.json\0b.jsonc\0");
  expect(listGitFiles("/repo", [":(glob)**/*.json", ":(glob)**/*.jsonc"])).toEqual([
    "a.json",
    "b.jsonc",
  ]);
  expect(execFileSync).toHaveBeenLastCalledWith(
    "/usr/bin/git",
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
    { cwd: "/repo", encoding: "utf8" },
  );
  expect(listGitFiles("/repo")).toEqual(["src/live.ts", ".opencode/plugin/codex-web-search.ts"]);
});

it("classifies only declarative package-root barrels", () => {
  expect(isRootSourceBarrel("packages/core/src/index.ts")).toBe(true);
  expect(isRootSourceBarrel("src/index.mts")).toBe(true);
  expect(isRootSourceBarrel("packages/core/src/nested/src/index.ts")).toBe(false);
  expect(
    isDeclarativeRootBarrel(
      "packages/core/src/index.ts",
      '// exports\nexport * as api from "./api.ts";\nexport { value } from "./value.ts";',
    ),
  ).toBe(true);
  expect(isDeclarativeRootBarrel("packages/core/src/index.ts", "export const value = 1;")).toBe(
    false,
  );
  expect(isDeclarativeRootBarrel("packages/core/src/index.ts", "export {")).toBe(false);
  expect(
    isDeclarativeRootBarrel("packages/core/src/nested/index.ts", 'export * from "./x.ts";'),
  ).toBe(false);
});

it("reads listed TypeScript files", () => {
  const access: SourceFileAccess = {
    listPaths: () => ["src/a.ts"],
    readText: (path) => `contents:${path.endsWith("src/a.ts")}`,
  };

  expect(readTypeScriptFiles("/repo", access)).toEqual([
    { content: "contents:true", path: "src/a.ts" },
  ]);
});

it("reads TypeScript files through the live adapters", () => {
  expect(readTypeScriptFiles("/repo")).toEqual([{ content: "live contents", path: "src/live.ts" }]);
  expect(execFileSync).toHaveBeenCalledWith(
    "/usr/bin/git",
    [
      "ls-files",
      "-z",
      "--cached",
      "--others",
      "--exclude-standard",
      "--",
      ":(glob)**/*.ts",
      ":(glob)**/*.tsx",
      ":(glob)**/*.mts",
      ":(glob)**/*.cts",
    ],
    { cwd: "/repo", encoding: "utf8" },
  );
  expect(readFileSync).toHaveBeenCalledWith("/repo/src/live.ts", "utf8");
});

describe("static scope", () => {
  it("rejects TypeScript in directories excluded by static tools", () => {
    expect(
      findExcludedTypeScriptFiles(
        [
          "src/live.ts",
          "ignored/custom.ts",
          ".stryker-tmp/mutant.ts",
          ".turbo/generated.ts",
          "packages/core/dist/index.ts",
          "reports/generated.tsx",
          "nested/node_modules/dependency.mts",
        ],
        ["ignored/custom.ts"],
      ),
    ).toEqual([
      "ignored/custom.ts",
      ".stryker-tmp/mutant.ts",
      ".turbo/generated.ts",
      "packages/core/dist/index.ts",
      "reports/generated.tsx",
      "nested/node_modules/dependency.mts",
    ]);
  });

  it("reports violations and passes clean paths", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const access: StaticScopeAccess = {
      listIgnoredPaths: () => [],
      listPaths: () => ["src/live.ts", "coverage/hidden.cts"],
    };

    expect(runStaticScopeGate("/repo", access)).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "coverage/hidden.cts: TypeScript is not permitted in a static-gate excluded directory",
    );
    expect(runStaticScopeGate("/repo", { ...access, listPaths: () => ["src/live.ts"] })).toBe(0);
  });

  it("checks git ignores through the live adapters", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(execFileSync).mockReturnValueOnce("src/live.ts\0src/other.ts\0");
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 0,
      stdout: "src/live.ts\0",
    } as ReturnType<typeof spawnSync>);

    expect(runStaticScopeGate("/repo")).toBe(1);
    expect(spawnSync).toHaveBeenCalledWith(
      "/usr/bin/git",
      ["check-ignore", "-z", "--no-index", "--stdin"],
      {
        cwd: "/repo",
        encoding: "utf8",
        input: "src/live.ts\0src/other.ts\0",
      },
    );
    error.mockRestore();
  });

  it("handles empty discovery and git failures", () => {
    vi.mocked(execFileSync).mockReturnValueOnce("");
    vi.mocked(spawnSync).mockReturnValueOnce({ status: 1, stdout: "" } as ReturnType<
      typeof spawnSync
    >);
    expect(runStaticScopeGate("/repo")).toBe(0);

    vi.mocked(spawnSync).mockReturnValueOnce({ status: 1, stdout: "" } as ReturnType<
      typeof spawnSync
    >);
    expect(runStaticScopeGate("/repo")).toBe(0);

    vi.mocked(spawnSync).mockReturnValueOnce({
      error: new Error("spawn failed"),
      status: null,
      stdout: "",
    } as ReturnType<typeof spawnSync>);
    expect(() => runStaticScopeGate("/repo")).toThrow("spawn failed");

    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 2,
      stdout: "",
    } as ReturnType<typeof spawnSync>);
    expect(() => runStaticScopeGate("/repo")).toThrow("git check-ignore failed with status 2");
  });
});
