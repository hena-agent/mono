import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";

import type { JsonCandidate } from "@hena-dev/core";
import { runFta, type AnalyzedFile } from "fta-cli";
import {
  analyzeFileComplexity,
  type FileAnalysisResult,
} from "oxlint-plugin-complexity/standalone";

import type { SourceFile, SourceFileAccess } from "./files.ts";
import { readTypeScriptFiles } from "./files.ts";

export interface MetricsReport {
  readonly analyzedFiles: number;
  readonly maxCognitive: number;
  readonly maxCyclomatic: number;
  readonly maxCrap: number;
  readonly maxHalsteadDifficulty: number;
  readonly violations: readonly string[];
}

export interface MetricsServices {
  readonly analyzeFta: (files: readonly SourceFile[]) => readonly AnalyzedFile[];
  readonly analyzeSource: (code: string, filename: string) => FileAnalysisResult;
  readonly sourceAccess?: SourceFileAccess;
  readonly writeReport: (path: string, report: MetricsReport) => void;
}

const analyzeFtaFiles = (files: readonly SourceFile[]): readonly AnalyzedFile[] => {
  if (files.length === 0) {
    return [];
  }

  const directory = mkdtempSync(join(tmpdir(), "hena-fta-"));
  try {
    writeFileSync(join(directory, "fta.json"), '{"exclude_under":0}\n');
    const stagedFiles = files.map((file, index) => {
      const name = `${index}${extname(file.path)}`;
      // Keep empty and declarative files visible to FTA's parser and result reconciliation.
      writeFileSync(join(directory, name), `${file.content}\n;`);
      return { name, path: file.path };
    });
    const results: readonly AnalyzedFile[] = JSON.parse(runFta(directory, { json: true }));

    if (results.length !== stagedFiles.length) {
      throw new Error(`FTA analyzed ${results.length} of ${stagedFiles.length} TypeScript files`);
    }

    const resultsByName = new Map(results.map((result) => [result.file_name, result]));
    return stagedFiles.map((file) => {
      const result = resultsByName.get(file.name);
      if (result === undefined) {
        throw new Error(`FTA omitted ${file.path}`);
      }
      return { ...result, file_name: file.path };
    });
  } finally {
    rmSync(directory, { recursive: true });
  }
};

export const liveMetricsServices: MetricsServices = {
  analyzeFta: analyzeFtaFiles,
  analyzeSource: analyzeFileComplexity,
  writeReport: (path, report) => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  },
};

const requireRecord = (
  value: JsonCandidate,
  message: string,
): Readonly<Record<string, JsonCandidate>> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(message);
  }
  return value as JsonCandidate & Readonly<Record<string, JsonCandidate>>;
};

const requireNonEmptyString = (value: JsonCandidate, message: string): void => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(message);
  }
};

const requireFiniteNonnegativeNumber = (value: JsonCandidate, message: string): void => {
  if (!Number.isFinite(value) || (value as number) < 0) {
    throw new TypeError(message);
  }
};

const validateFtaFiles = (files: readonly AnalyzedFile[]): void => {
  for (const [index, candidate] of files.entries()) {
    const context = `FTA result ${index}`;
    const file = requireRecord(
      candidate as AnalyzedFile & JsonCandidate,
      `${context} must be an object`,
    );
    requireNonEmptyString(file["file_name"], `${context} file_name must be a non-empty string`);
    const halstead = requireRecord(file["halstead"], `${context} halstead must be an object`);
    requireFiniteNonnegativeNumber(
      halstead["difficulty"],
      `${context} Halstead difficulty must be a finite nonnegative number`,
    );
  }
};

const validateComplexityFiles = (files: readonly FileAnalysisResult[]): void => {
  for (const [fileIndex, candidate] of files.entries()) {
    const context = `Complexity result ${fileIndex}`;
    const file = requireRecord(
      candidate as FileAnalysisResult & JsonCandidate,
      `${context} must be an object`,
    );
    requireNonEmptyString(file["filename"], `${context} filename must be a non-empty string`);
    const functions = file["functions"];
    if (!Array.isArray(functions)) {
      throw new TypeError(`${context} functions must be an array`);
    }
    for (const [functionIndex, functionCandidate] of functions.entries()) {
      const functionContext = `${context} function ${functionIndex}`;
      const item = requireRecord(functionCandidate, `${functionContext} must be an object`);
      requireNonEmptyString(item["name"], `${functionContext} name must be a non-empty string`);
      const startLine = item["startLine"];
      if (!Number.isInteger(startLine) || (startLine as number) <= 0) {
        throw new TypeError(`${functionContext} startLine must be a positive integer`);
      }
      requireFiniteNonnegativeNumber(
        item["cyclomatic"],
        `${functionContext} cyclomatic must be a finite nonnegative number`,
      );
      requireFiniteNonnegativeNumber(
        item["cognitive"],
        `${functionContext} cognitive must be a finite nonnegative number`,
      );
    }
  }
};

export const createMetricsReport = (
  ftaFiles: readonly AnalyzedFile[],
  complexityFiles: readonly FileAnalysisResult[],
): MetricsReport => {
  validateFtaFiles(ftaFiles);
  validateComplexityFiles(complexityFiles);
  const functions = complexityFiles.flatMap((file) => file.functions);
  const halsteadViolations = ftaFiles
    .filter((file) => file.halstead.difficulty >= 80)
    .map(
      (file) => `${file.file_name}: Halstead difficulty ${file.halstead.difficulty} is not < 80`,
    );
  const complexityViolations = complexityFiles.flatMap((file) =>
    file.functions.flatMap((item) => {
      const location = `${file.filename}:${item.name}:${item.startLine}`;
      const cyclomatic =
        item.cyclomatic >= 22 ? [`${location}: cyclomatic ${item.cyclomatic} is not < 22`] : [];
      const cognitive =
        item.cognitive >= 22 ? [`${location}: cognitive ${item.cognitive} is not < 22`] : [];
      return [...cyclomatic, ...cognitive];
    }),
  );
  const maxCyclomatic = Math.max(0, ...functions.map((item) => item.cyclomatic));

  return {
    analyzedFiles: ftaFiles.length,
    maxCognitive: Math.max(0, ...functions.map((item) => item.cognitive)),
    maxCyclomatic,
    maxCrap: maxCyclomatic,
    maxHalsteadDifficulty: Math.max(0, ...ftaFiles.map((file) => file.halstead.difficulty)),
    violations: [...halsteadViolations, ...complexityViolations],
  };
};

export const runMetricsGate = (
  cwd: string,
  services: MetricsServices = liveMetricsServices,
): number => {
  const sourceFiles = readTypeScriptFiles(cwd, services.sourceAccess);
  const ftaFiles = services.analyzeFta(sourceFiles);
  const complexityFiles = sourceFiles.map((file) =>
    services.analyzeSource(file.content, file.path),
  );
  const report = createMetricsReport(ftaFiles, complexityFiles);
  services.writeReport(join(cwd, "reports/metrics.json"), report);

  for (const violation of report.violations) {
    console.error(violation);
  }

  return report.violations.length === 0 ? 0 : 1;
};
