import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { JsonCandidate } from "@hena-dev/core";

import { runMutationReportGate, type MutationReportAccess } from "./mutation.ts";

const baseReport = {
  framework: { name: "StrykerJS", version: "10.0.0" },
  projectRoot: "/repo/packages/core",
  schemaVersion: "1.0",
  testFiles: { "src/a.test.ts": { tests: [{ id: "test-1", name: "kills mutant" }] } },
  thresholds: { break: 100, high: 100, low: 100 },
} as const;
const killedMutant = {
  coveredBy: ["test-1"],
  id: "1",
  killedBy: ["test-1"],
  location: { end: { column: 2, line: 1 }, start: { column: 1, line: 1 } },
  mutatorName: "StringLiteral",
  replacement: '"changed"',
  status: "Killed",
} as const;
const mutationFile = (mutants: readonly JsonCandidate[], source = "export const value = 1;") => ({
  language: "typescript",
  mutants,
  source,
});
const report = (
  files: Readonly<Record<string, JsonCandidate>>,
  changes: Readonly<Record<string, JsonCandidate>> = {},
): JsonCandidate => ({ ...baseReport, files, ...changes });
const access = (
  candidate: ReturnType<MutationReportAccess["readReport"]>,
  sources: readonly string[] = ["packages/core/src/a.ts"],
): MutationReportAccess => ({
  listPackagePaths: () => ["packages/core"],
  readReport: () => candidate,
  readSources: () => sources.map((path) => ({ content: "export const value = 1;", path })),
});

describe("runMutationReportGate", () => {
  it("passes complete reports and fails empty reports", () => {
    expect(
      runMutationReportGate("/repo", access(report({ "src/a.ts": mutationFile([killedMutant]) }))),
    ).toBe(0);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(runMutationReportGate("/repo", access(report({}), []))).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "packages/core: mutation report must contain at least one mutant",
    );
    error.mockRestore();
  });

  it("requires every implementation source in the owning report", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sources = [
      "packages/core/src/index.ts",
      "packages/core/src/a.test.ts",
      "packages/core/src/types.d.ts",
      "packages/core/src/a.ts",
      "packages/core/src/.hidden.ts",
      "packages/core/src/a.test.ts.ts",
      "packages/core/src/types.d.ts.ts",
      "packages/core/src/index.ts.ts",
      "packages/core/src/nested/src/index.ts",
      "prefix/packages/core/src/outside.ts",
    ];

    expect(
      runMutationReportGate(
        "/repo",
        access(report({ "src/a.ts": mutationFile([killedMutant]) }), sources),
      ),
    ).toBe(1);
    for (const path of [
      ".hidden.ts",
      "a.test.ts.ts",
      "types.d.ts.ts",
      "index.ts.ts",
      "nested/src/index.ts",
    ]) {
      expect(error).toHaveBeenCalledWith(`packages/core/src/${path}: missing from mutation report`);
    }
    expect(error).toHaveBeenCalledTimes(5);
    error.mockRestore();
  });

  it("normalizes Windows paths without losing prototype-key paths", () => {
    const files = Object.fromEntries([
      ["src\\a.ts", mutationFile([killedMutant])],
      ["__proto__", mutationFile([{ ...killedMutant, id: "2" }], "prototype source")],
    ]);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(runMutationReportGate("/repo", access(report(files)))).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "packages/core/reports/mutation/mutation.json: unexpected mutation report file __proto__",
    );
    expect(error).toHaveBeenCalledTimes(1);
    error.mockRestore();
  });

  it("rejects stale, unexpected, and wrong-root report data", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const candidate = report(
      {
        "src/a.ts": mutationFile([killedMutant], "stale"),
        "src/extra.ts": mutationFile([{ ...killedMutant, id: "2" }]),
      },
      { projectRoot: "/wrong" },
    );

    expect(runMutationReportGate("/repo", access(candidate))).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "packages/core/reports/mutation/mutation.json: projectRoot does not match /repo/packages/core",
    );
    expect(error).toHaveBeenCalledWith(
      "packages/core/src/a.ts: mutation report source does not match",
    );
    expect(error).toHaveBeenCalledWith(
      "packages/core/reports/mutation/mutation.json: unexpected mutation report file src/extra.ts",
    );
    error.mockRestore();
  });

  it("reads live package reports and source files", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hena-mutation-"));
    const reportDirectory = join(cwd, "packages", "core", "reports", "mutation");
    const sourceDirectory = join(cwd, "packages", "core", "src");
    mkdirSync(reportDirectory, { recursive: true });
    mkdirSync(sourceDirectory, { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd });
    writeFileSync(join(cwd, "packages", "not-a-package"), "ignored");
    writeFileSync(join(sourceDirectory, "a.ts"), "export const value = 1;");
    writeFileSync(join(reportDirectory, "mutation.json"), JSON.stringify(report({})));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(runMutationReportGate(cwd)).toBe(1);
      expect(error).toHaveBeenCalledWith(
        "packages/core: mutation report must contain at least one mutant",
      );
      expect(error).toHaveBeenCalledWith("packages/core/src/a.ts: missing from mutation report");
    } finally {
      error.mockRestore();
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});
