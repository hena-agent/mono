import { existsSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

import type { JsonCandidate } from "@hena-dev/core";
import { runFta, type AnalyzedFile } from "fta-cli";
import {
  analyzeFileComplexity,
  type FileAnalysisResult,
} from "oxlint-plugin-complexity/standalone";
import { describe, expect, it, vi } from "vitest";

vi.mock("fta-cli", () => ({ runFta: vi.fn() }));
vi.mock("oxlint-plugin-complexity/standalone", () => ({
  analyzeFileComplexity: vi.fn(),
}));

import type { SourceFile, SourceFileAccess } from "./files.ts";
import {
  createMetricsReport,
  liveMetricsServices,
  runMetricsGate,
  type MetricsReport,
  type MetricsServices,
} from "./metrics.ts";

const ftaFile = (difficulty: number, fileName = "src/file.ts"): AnalyzedFile => ({
  assessment: "OK",
  cyclo: 1,
  file_name: fileName,
  fta_score: 1,
  halstead: {
    bugs: 0,
    difficulty,
    effort: 0,
    program_length: 0,
    time: 0,
    total_operands: 0,
    total_operators: 0,
    uniq_operands: 0,
    uniq_operators: 0,
    vocabulary_size: 0,
    volume: 0,
  },
  line_count: 1,
});

const complexityFile = (cyclomatic: number, cognitive: number): FileAnalysisResult => ({
  filename: "src/file.ts",
  functions: [
    {
      cognitive,
      cognitivePoints: [],
      cyclomatic,
      cyclomaticPoints: [],
      endLine: 1,
      name: "functionName",
      startLine: 1,
    },
  ],
});

const analyzerOutput = <T>(value: JsonCandidate): T => value as JsonCandidate & T;

const ftaFileWithDifficulty = (difficulty: JsonCandidate): AnalyzedFile => {
  const file = ftaFile(1);
  return analyzerOutput({ ...file, halstead: { ...file.halstead, difficulty } });
};

const complexityFileWithFunction = (value: JsonCandidate): FileAnalysisResult =>
  analyzerOutput({ ...complexityFile(1, 1), functions: [value] });

const complexityFileWithFunctionFields = (
  fields: Readonly<Record<string, JsonCandidate>>,
): FileAnalysisResult =>
  complexityFileWithFunction({
    cognitive: 1,
    cognitivePoints: [],
    cyclomatic: 1,
    cyclomaticPoints: [],
    endLine: 1,
    name: "functionName",
    startLine: 1,
    ...fields,
  });

const invalidMetricValues: readonly JsonCandidate[] = [
  null,
  "1",
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  -1,
];

describe("createMetricsReport", () => {
  it("returns maxima and CRAP at full coverage", () => {
    expect(createMetricsReport([ftaFile(79)], [complexityFile(21, 20)])).toEqual({
      analyzedFiles: 1,
      maxCognitive: 20,
      maxCrap: 21,
      maxCyclomatic: 21,
      maxHalsteadDifficulty: 79,
      violations: [],
    });
  });

  it("reports every threshold violation", () => {
    const report = createMetricsReport([ftaFile(80)], [complexityFile(22, 22)]);

    expect(report.violations).toEqual([
      "src/file.ts: Halstead difficulty 80 is not < 80",
      "src/file.ts:functionName:1: cyclomatic 22 is not < 22",
      "src/file.ts:functionName:1: cognitive 22 is not < 22",
    ]);
  });

  it("handles empty analyses", () => {
    expect(createMetricsReport([], [])).toMatchObject({
      analyzedFiles: 0,
      maxCognitive: 0,
      maxCyclomatic: 0,
      maxHalsteadDifficulty: 0,
    });
  });

  it("accepts zero analyzer metrics", () => {
    expect(createMetricsReport([ftaFile(0)], [complexityFile(0, 0)])).toMatchObject({
      maxCognitive: 0,
      maxCyclomatic: 0,
      maxHalsteadDifficulty: 0,
      violations: [],
    });
  });

  it("rejects malformed FTA result structure", () => {
    for (const candidate of [null, "invalid", []]) {
      expect(() => createMetricsReport([analyzerOutput(candidate)], [])).toThrow(
        "FTA result 0 must be an object",
      );
    }
    for (const fileName of [null, "", "   "]) {
      expect(() =>
        createMetricsReport([analyzerOutput({ ...ftaFile(1), file_name: fileName })], []),
      ).toThrow("FTA result 0 file_name must be a non-empty string");
    }
    for (const halstead of [null, "invalid", []]) {
      expect(() => createMetricsReport([analyzerOutput({ ...ftaFile(1), halstead })], [])).toThrow(
        "FTA result 0 halstead must be an object",
      );
    }
  });

  it("rejects malformed FTA difficulty", () => {
    for (const difficulty of invalidMetricValues) {
      expect(() => createMetricsReport([ftaFileWithDifficulty(difficulty)], [])).toThrow(
        "FTA result 0 Halstead difficulty must be a finite nonnegative number",
      );
    }
  });

  it("rejects malformed complexity file structure", () => {
    for (const candidate of [null, "invalid", []]) {
      expect(() => createMetricsReport([], [analyzerOutput(candidate)])).toThrow(
        "Complexity result 0 must be an object",
      );
    }
    for (const filename of [null, "", "   "]) {
      expect(() => createMetricsReport([], [analyzerOutput({ filename, functions: [] })])).toThrow(
        "Complexity result 0 filename must be a non-empty string",
      );
    }
    for (const functions of [null, "invalid", {}]) {
      expect(() =>
        createMetricsReport([], [analyzerOutput({ filename: "src/file.ts", functions })]),
      ).toThrow("Complexity result 0 functions must be an array");
    }
  });

  it("rejects malformed complexity function identity", () => {
    for (const candidate of [null, "invalid", []]) {
      expect(() => createMetricsReport([], [complexityFileWithFunction(candidate)])).toThrow(
        "Complexity result 0 function 0 must be an object",
      );
    }
    for (const name of [null, "", "   "]) {
      expect(() => createMetricsReport([], [complexityFileWithFunctionFields({ name })])).toThrow(
        "Complexity result 0 function 0 name must be a non-empty string",
      );
    }
    for (const startLine of [null, "1", Number.NaN, Number.POSITIVE_INFINITY, -1, 0, 1.5]) {
      expect(() =>
        createMetricsReport([], [complexityFileWithFunctionFields({ startLine })]),
      ).toThrow("Complexity result 0 function 0 startLine must be a positive integer");
    }
  });

  it("rejects malformed complexity metrics", () => {
    for (const metric of ["cyclomatic", "cognitive"] as const) {
      for (const value of invalidMetricValues) {
        expect(() =>
          createMetricsReport([], [complexityFileWithFunctionFields({ [metric]: value })]),
        ).toThrow(`Complexity result 0 function 0 ${metric} must be a finite nonnegative number`);
      }
    }
  });
});

describe("runMetricsGate", () => {
  const sourceAccess: SourceFileAccess = {
    listPaths: () => ["src/file.ts"],
    readText: () => "export const value = 1",
  };

  const services = (report: MetricsReport[], difficulty: number): MetricsServices => ({
    analyzeFta: () => [ftaFile(difficulty)],
    analyzeSource: () => complexityFile(1, 0),
    sourceAccess,
    writeReport: (_path, value) => report.push(value),
  });

  it("writes a passing report", () => {
    const reports: MetricsReport[] = [];
    expect(runMetricsGate("/repo", services(reports, 1))).toBe(0);
    expect(reports).toHaveLength(1);
  });

  it("prints and fails a violating report", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(runMetricsGate("/repo", services([], 80))).toBe(1);
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("uses the live FTA, complexity, and report adapters", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hena-metrics-"));
    let stagedDirectory = "";
    vi.mocked(runFta).mockImplementation((path) => {
      stagedDirectory = path;
      expect(basename(path)).toMatch(/^hena-fta-/);
      expect(readFileSync(join(path, "fta.json"), "utf8")).toBe('{"exclude_under":0}\n');
      expect(readdirSync(path).sort()).toEqual(["0.ts", "fta.json"]);
      expect(readFileSync(join(path, "0.ts"), "utf8")).toBe("export const value = 1\n;");
      return JSON.stringify([ftaFile(1, "0.ts")]);
    });
    vi.mocked(analyzeFileComplexity).mockReturnValue(complexityFile(1, 0));

    expect(runMetricsGate(cwd, { ...liveMetricsServices, sourceAccess })).toBe(0);
    expect(runMetricsGate(cwd, { ...liveMetricsServices, sourceAccess })).toBe(0);
    expect(runFta).toHaveBeenCalledWith(stagedDirectory, { json: true });
    expect(analyzeFileComplexity).toHaveBeenCalledWith("export const value = 1", "src/file.ts");
    expect(readFileSync(join(cwd, "reports/metrics.json"), "utf8")).toContain('"maxCrap": 1');
    expect(existsSync(stagedDirectory)).toBe(false);
  });

  it("stages every TypeScript form and remaps shuffled FTA results", () => {
    const files: readonly SourceFile[] = [
      { content: "export const view = <div />", path: "src/view.tsx" },
      { content: "export const value = 1", path: "config.mts" },
    ];
    vi.mocked(runFta).mockImplementation((path) => {
      expect(readdirSync(path).sort()).toEqual(["0.tsx", "1.mts", "fta.json"]);
      return JSON.stringify([ftaFile(2, "1.mts"), ftaFile(1, "0.tsx")]);
    });

    expect(liveMetricsServices.analyzeFta(files).map((file) => file.file_name)).toEqual([
      "src/view.tsx",
      "config.mts",
    ]);
  });

  it("fails closed when FTA omits a file", () => {
    vi.mocked(runFta).mockReturnValue(JSON.stringify([]));

    expect(() => liveMetricsServices.analyzeFta([{ content: "", path: "src/short.cts" }])).toThrow(
      "FTA analyzed 0 of 1 TypeScript files",
    );
  });

  it("fails closed when FTA returns the wrong file", () => {
    vi.mocked(runFta).mockReturnValue(JSON.stringify([ftaFile(1, "unexpected.ts")]));

    expect(() =>
      liveMetricsServices.analyzeFta([{ content: "export const value = 1", path: "src/file.ts" }]),
    ).toThrow("FTA omitted src/file.ts");
  });

  it("handles an empty source set without invoking FTA", () => {
    vi.mocked(runFta).mockClear();

    expect(liveMetricsServices.analyzeFta([])).toEqual([]);
    expect(runFta).not.toHaveBeenCalled();
  });
});
