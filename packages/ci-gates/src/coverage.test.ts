import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonCandidate } from "@hena-dev/core";
import { describe, expect, it, vi } from "vitest";

import {
  findMissingCoverageFiles,
  runCoverageFileGate,
  type CoverageFileAccess,
} from "./coverage.ts";

const sourceContent = "export const value = 1;\n";
const location = (
  start: readonly [line: number, column: number] = [1, 0],
  end: readonly [line: number, column: number] = [1, 1],
) => ({
  end: { column: end[1], line: end[0] },
  start: { column: start[1], line: start[0] },
});
const endOfLineLocation = (
  start: readonly [line: number, column: number] = [1, 0],
  endLine = 1,
) => ({ end: { column: null, line: endLine }, start: { column: start[1], line: start[0] } });
const sources = (...paths: readonly string[]) =>
  paths.map((path) => ({ content: sourceContent, path }));

const coverageEntry = (
  path: string,
  counters: {
    readonly b: Readonly<Record<string, readonly number[]>>;
    readonly f: Readonly<Record<string, number>>;
    readonly s: Readonly<Record<string, number>>;
  },
) => ({
  b: counters.b,
  branchMap: Object.fromEntries(
    Object.entries(counters.b).map(([key, counts]) => [
      key,
      { line: 1, loc: location(), locations: counts.map(() => location()), type: "if" },
    ]),
  ),
  f: counters.f,
  fnMap: Object.fromEntries(
    Object.keys(counters.f).map((key) => [
      key,
      { decl: location(), line: 1, loc: location(), name: "covered" },
    ]),
  ),
  path,
  s: counters.s,
  statementMap: Object.fromEntries(Object.keys(counters.s).map((key) => [key, location()])),
});

const fullyCovered = (path: string) =>
  coverageEntry(path, { b: { 0: [1] }, f: { 0: 1 }, s: { 0: 1 } });

it("findMissingCoverageFiles returns source files absent from the report", () => {
  expect(findMissingCoverageFiles(["a.ts", "b.ts"], ["b.ts"])).toEqual(["a.ts"]);
});

describe("runCoverageFileGate", () => {
  const access = (report: ReturnType<CoverageFileAccess["readReport"]>): CoverageFileAccess => ({
    readReport: () => report,
    readSources: () =>
      sources(
        "packages/core/src/a.ts",
        "packages/core/src/view.tsx",
        "packages/core/src/nested/file.ts",
        "packages/core/src/a.test.ts",
        "packages/core/src/a.test.ts.ts",
        "prefix/packages/core/src/ignored.ts",
        "packages/core/src/ignored.ts.extra",
        "root.mts",
      ),
  });

  it("passes when every production source appears in coverage", () => {
    expect(
      runCoverageFileGate(
        "/repo",
        access({
          "/repo/packages/core/src/a.ts": fullyCovered("/repo/packages/core/src/a.ts"),
          "/repo/packages/core/src/view.tsx": fullyCovered("/repo/packages/core/src/view.tsx"),
          "/repo/packages/core/src/nested\\file.ts": fullyCovered(
            "/repo/packages/core/src/nested/file.ts",
          ),
          "/repo/packages/core/src/a.test.ts.ts": fullyCovered(
            "/repo/packages/core/src/a.test.ts.ts",
          ),
        }),
      ),
    ).toBe(0);
  });

  it("reconciles source paths containing newlines", () => {
    const newlineAccess: CoverageFileAccess = {
      readReport: () => ({
        "/repo/packages/core/src/line\nbreak.ts": fullyCovered(
          "/repo/packages/core/src/line\nbreak.ts",
        ),
      }),
      readSources: () => sources("packages/core/src/line\nbreak.ts"),
    };

    expect(runCoverageFileGate("/repo", newlineAccess)).toBe(0);
  });

  it("prints and fails files omitted by the coverage provider", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(
      runCoverageFileGate(
        "/repo",
        access({ "/repo/packages/core/src/a.ts": fullyCovered("/repo/packages/core/src/a.ts") }),
      ),
    ).toBe(1);
    expect(error).toHaveBeenCalledWith("packages/core/src/view.tsx: missing from coverage report");
    expect(error).toHaveBeenCalledWith(
      "packages/core/src/a.test.ts.ts: missing from coverage report",
    );
    error.mockRestore();
  });

  it("requires each source in its owning package report", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const packageAccess: CoverageFileAccess = {
      readReport: (path) =>
        path.includes("packages/core/")
          ? {
              "/repo/packages/core/src/file.ts": fullyCovered("/repo/packages/core/src/file.ts"),
              "/repo/packages/other/src/file.ts": fullyCovered("/repo/packages/other/src/file.ts"),
            }
          : {},
      readSources: () => sources("packages/core/src/file.ts", "packages/other/src/file.ts"),
    };

    expect(runCoverageFileGate("/repo", packageAccess)).toBe(1);
    expect(error).toHaveBeenCalledWith("packages/other/src/file.ts: missing from coverage report");
    expect(error).toHaveBeenCalledWith(
      "packages/other/src/file.ts: unexpected file in packages/core coverage report",
    );
    expect(error).not.toHaveBeenCalledWith(
      "packages/core/src/file.ts: missing from coverage report",
    );
    error.mockRestore();
  });

  it("rejects invalid coverage reports", () => {
    for (const report of [[], undefined, null, "report"] as const) {
      expect(() => runCoverageFileGate("/repo", access(report))).toThrow(
        "packages/core/coverage/coverage-final.json must be a JSON object",
      );
    }
  });

  it("rejects malformed or zero coverage counters", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const path = "/repo/packages/core/src/a.ts";
    const covered = fullyCovered(path);
    const twoStatements = coverageEntry(path, { b: {}, f: {}, s: { 0: 1, 1: 1 } });
    const twoFunctions = coverageEntry(path, { b: {}, f: { 0: 1, 1: 1 }, s: {} });
    const twoBranches = coverageEntry(path, { b: { 0: [1, 1] }, f: {}, s: {} });
    const singleSource: CoverageFileAccess = {
      readReport: () => ({ "/repo/packages/core/src/a.ts": { b: { 0: [1, 0] }, f: {}, s: {} } }),
      readSources: () => sources("packages/core/src/a.ts"),
    };

    expect(runCoverageFileGate("/repo", singleSource)).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "packages/core/src/a.ts: coverage report is malformed or below 100%",
    );
    for (const entry of [
      null,
      {},
      { b: {}, f: {}, s: {} },
      { b: {}, f: {}, s: null },
      { b: {}, f: { 0: 0 }, s: {} },
      { b: {}, f: {}, s: { 0: 0 } },
      { b: { 0: null }, f: {}, s: {} },
      { b: {}, f: {}, s: { 0: 1, 1: 0 } },
      { b: {}, f: { 0: 1, 1: 0 }, s: {} },
      { b: { 0: [1], 1: [0] }, f: {}, s: {} },
      { b: {}, f: {}, s: { 0: "1" } },
      { b: {}, f: { 0: "1" }, s: {} },
      { b: { 0: ["1"] }, f: {}, s: {} },
      { ...covered, s: { 0: 0.5 } },
      { ...covered, f: { 0: Number.MAX_SAFE_INTEGER + 1 } },
      { ...covered, b: { 0: [] } },
      { ...covered, b: { 0: { 0: 1, length: 1 } } },
      coverageEntry(path, { b: { 0: [] }, f: {}, s: {} }),
      coverageEntry(path, { b: {}, f: {}, s: { invalid: 1 } }),
      coverageEntry(path, { b: {}, f: {}, s: { "01": 1 } }),
      coverageEntry(path, { b: {}, f: {}, s: { "12x": 1 } }),
      coverageEntry(path, { b: {}, f: {}, s: { x12: 1 } }),
      coverageEntry(path, {
        b: {},
        f: {},
        s: { [String(Number.MAX_SAFE_INTEGER + 1)]: 1 },
      }),
      coverageEntry(path, { b: { "01": [1] }, f: {}, s: {} }),
      {
        ...covered,
        path: "/repo/packages/core/src/other.ts",
      },
      { ...covered, statementMap: {} },
      { ...covered, statementMap: { 0: location(), 1: location() } },
      { ...covered, statementMap: { 0: null } },
      { ...covered, fnMap: { 0: null } },
      { ...covered, fnMap: { 0: { ...covered.fnMap[0], name: 1 } } },
      { ...covered, fnMap: { 0: { ...covered.fnMap[0], name: "" } } },
      {
        ...covered,
        branchMap: { 0: { locations: [] } },
      },
      { ...covered, statementMap: { 0: {}, 1: {} } },
      { ...twoStatements, s: { 0: 1, 1: "1" } },
      { ...twoStatements, s: { 0: 1, 1: 0 } },
      { ...twoFunctions, f: { 0: 1, 1: "1" } },
      { ...twoFunctions, f: { 0: 1, 1: 0 } },
      { ...covered, b: { 0: 1 } },
      { ...twoBranches, b: { 0: [1, "1"] } },
      { ...twoBranches, b: { 0: [1, 0] } },
      {
        ...covered,
        branchMap: { 0: [] },
      },
      {
        ...covered,
        branchMap: { 0: { locations: { 0: {}, length: 1 } } },
      },
    ]) {
      expect(
        runCoverageFileGate("/repo", {
          readReport: () => ({ [path]: entry }),
          readSources: () => sources("packages/core/src/a.ts"),
        }),
      ).toBe(1);
    }
    error.mockRestore();
  });

  it("allows empty counters only for declarative root barrels", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const barrelContent =
      '// barrel comment\nexport { value } from "./value.ts";\nexport * from "./other.ts";\n';
    expect(
      runCoverageFileGate("/repo", {
        readReport: () => ({
          "/repo/packages/core/src/index.ts": coverageEntry("/repo/packages/core/src/index.ts", {
            b: {},
            f: {},
            s: {},
          }),
        }),
        readSources: () => [{ content: barrelContent, path: "packages/core/src/index.ts" }],
      }),
    ).toBe(0);
    for (const path of [
      "packages/core/src/index.ts.ts",
      "packages/outer/src/packages/core/src/index.ts",
    ]) {
      expect(
        runCoverageFileGate("/repo", {
          readReport: () => ({
            [`/repo/${path}`]: coverageEntry(`/repo/${path}`, { b: {}, f: {}, s: {} }),
          }),
          readSources: () => [{ content: barrelContent, path }],
        }),
      ).toBe(1);
    }
    for (const content of [
      "",
      "// no declarations\n",
      "export const value = 1;\n",
      'import { value } from "./value.ts";\nexport { value };\n',
      'import {} from "./value.ts";\n',
      'export * from "./value.ts";\nexport const value = 1;\n',
      'export * from "./value.ts";\n/*',
      "export { value } from ;\n",
    ]) {
      expect(
        runCoverageFileGate("/repo", {
          readReport: () => ({
            "/repo/packages/core/src/index.ts": coverageEntry("/repo/packages/core/src/index.ts", {
              b: {},
              f: {},
              s: {},
            }),
          }),
          readSources: () => [{ content, path: "packages/core/src/index.ts" }],
        }),
      ).toBe(1);
    }
    error.mockRestore();
  });

  it("accepts coverage evidence from each counter map", () => {
    for (const counters of [
      { b: {}, f: {}, s: { 0: 1 } },
      { b: {}, f: { 0: 1 }, s: {} },
      { b: { 0: [1] }, f: {}, s: {} },
      { b: {}, f: {}, s: { 0: Number.MAX_SAFE_INTEGER } },
      { b: {}, f: {}, s: { 12: 1 } },
      { b: {}, f: {}, s: { 123: 1 } },
    ]) {
      expect(
        runCoverageFileGate("/repo", {
          readReport: () => ({
            "/repo/packages/core/src/a.ts": coverageEntry("/repo/packages/core/src/a.ts", counters),
          }),
          readSources: () => sources("packages/core/src/a.ts"),
        }),
      ).toBe(0);
    }
  });

  it("accepts pinned Vitest location sentinels", () => {
    const path = "/repo/packages/core/src/a.ts";
    const endOfLine = endOfLineLocation();
    const entry = {
      ...coverageEntry(path, { b: { 0: [1, 1] }, f: {}, s: { 0: 1 } }),
      branchMap: {
        0: {
          line: 1,
          loc: endOfLine,
          locations: [endOfLine, { end: {}, start: {} }],
          type: "if",
        },
      },
      statementMap: { 0: endOfLine },
    };

    expect(
      runCoverageFileGate("/repo", {
        readReport: () => ({ [path]: entry }),
        readSources: () => sources("packages/core/src/a.ts"),
      }),
    ).toBe(0);
  });

  it("requires ordered in-source locations throughout Istanbul metadata", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const path = "/repo/packages/core/src/a.ts";
    const content = "a;\nbc;";
    const covered = {
      ...coverageEntry(path, { b: { 0: [1, 1] }, f: { 0: 1 }, s: { 0: 1 } }),
      branchMap: {
        0: {
          line: 1,
          loc: location([1, 0], [2, 3]),
          locations: [location([1, 0], [1, 2]), location([2, 0], [2, 3])],
          type: "if",
        },
      },
      fnMap: {
        0: {
          decl: location([1, 0], [1, 2]),
          line: 2,
          loc: location([2, 0], [2, 3]),
          name: "covered",
        },
      },
      statementMap: { 0: location([1, 0], [2, 3]) },
    };
    const run = (entry: ReturnType<CoverageFileAccess["readReport"]>) =>
      runCoverageFileGate("/repo", {
        readReport: () => ({ [path]: entry }),
        readSources: () => [{ content, path: "packages/core/src/a.ts" }],
      });
    const emptyElse = { end: {}, start: {} };
    const withBranchLocations = (
      locations: readonly JsonCandidate[],
      counts: readonly number[] = [1, 1],
      type = "if",
    ) => ({
      ...covered,
      b: { 0: counts },
      branchMap: { 0: { ...covered.branchMap[0], locations, type } },
    });

    expect(run(covered)).toBe(0);
    expect(run({ ...covered, statementMap: { 0: location([1, 0], [1, 0]) } })).toBe(0);
    expect(run({ ...covered, statementMap: { 0: location([1, 2], [2, 0]) } })).toBe(0);
    for (const entry of [
      { ...covered, statementMap: { 0: location([0, 0], [1, 1]) } },
      { ...covered, statementMap: { 0: location([1, 0], [1, 3]) } },
      { ...covered, statementMap: { 0: location([2, 1], [1, 1]) } },
      { ...covered, statementMap: { 0: location([1, 2], [1, 1]) } },
      { ...covered, statementMap: { 0: location([1, 0.5], [1, 1]) } },
      {
        ...covered,
        statementMap: {
          0: { end: { column: 1, line: 1 }, start: { column: 0, line: "1" } },
        },
      },
      {
        ...covered,
        statementMap: {
          0: { end: { column: 1, line: 1 }, start: { column: 0, line: 1.5 } },
        },
      },
      {
        ...covered,
        statementMap: {
          0: { end: { column: 1, line: 1 }, start: { column: "0", line: 1 } },
        },
      },
      {
        ...covered,
        statementMap: { 0: { end: { column: 1, line: 1 }, start: null } },
      },
      {
        ...covered,
        statementMap: { 0: { end: { column: 1, line: 1 }, start: { column: null, line: 1 } } },
      },
      { ...covered, statementMap: { 0: endOfLineLocation([2, 0]) } },
      {
        ...covered,
        statementMap: {
          0: { ...endOfLineLocation(), start: { column: null, line: 1 } },
        },
      },
      { ...covered, statementMap: { 0: location([1, -1], [1, 1]) } },
      { ...covered, fnMap: { 0: { ...covered.fnMap[0], line: 1 } } },
      { ...covered, fnMap: { 0: { ...covered.fnMap[0], loc: null } } },
      {
        ...covered,
        fnMap: { 0: { ...covered.fnMap[0], decl: location([1, 0], [3, 0]) } },
      },
      { ...covered, branchMap: { 0: { ...covered.branchMap[0], type: "" } } },
      { ...covered, branchMap: { 0: { ...covered.branchMap[0], line: 2 } } },
      { ...covered, branchMap: { 0: { ...covered.branchMap[0], loc: null } } },
      withBranchLocations([location(), emptyElse], undefined, "cond-expr"),
      withBranchLocations([emptyElse, location()]),
      withBranchLocations([location(), emptyElse, location()], [1, 1, 1]),
      withBranchLocations([location(), null]),
      withBranchLocations([location(), { ...emptyElse, extra: 0 }]),
      withBranchLocations([location(), { end: {}, start: null }]),
      withBranchLocations([location(), { end: {}, start: { line: 1 } }]),
      withBranchLocations([location(), { end: null, start: {} }]),
      withBranchLocations([location(), { end: { line: 1 }, start: {} }]),
      {
        ...covered,
        branchMap: {
          0: { ...covered.branchMap[0], locations: [location(), location([3, 0], [3, 0])] },
        },
      },
      {
        ...covered,
        branchMap: { 0: { ...covered.branchMap[0], locations: [location()] } },
      },
    ]) {
      expect(run(entry)).toBe(1);
    }
    error.mockRestore();
  });

  it("rejects duplicate normalized report paths", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      runCoverageFileGate("/repo", {
        readReport: () => ({
          "/repo/packages/core/src/a.ts": fullyCovered("/repo/packages/core/src/a.ts"),
          "/repo/packages/core/src\\a.ts": fullyCovered("/repo/packages/core/src/a.ts"),
        }),
        readSources: () => sources("packages/core/src/a.ts"),
      }),
    ).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "packages/core/src/a.ts: duplicate normalized path in coverage report",
    );
    error.mockRestore();
  });

  it("reads git-discovered source content and coverage reports through live adapters", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hena-coverage-"));
    const sourceDirectory = join(cwd, "packages", "core", "src");
    const coverageDirectory = join(cwd, "packages", "core", "coverage");
    mkdirSync(sourceDirectory, { recursive: true });
    mkdirSync(coverageDirectory, { recursive: true });
    const sourcePath = join(sourceDirectory, "index.cts");
    writeFileSync(sourcePath, 'export { value } from "./value.js";\n');
    writeFileSync(
      join(coverageDirectory, "coverage-final.json"),
      JSON.stringify({ [sourcePath]: coverageEntry(sourcePath, { b: {}, f: {}, s: {} }) }),
    );
    execFileSync("git", ["init", "--quiet"], { cwd });

    try {
      expect(runCoverageFileGate(cwd)).toBe(0);
    } finally {
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});
