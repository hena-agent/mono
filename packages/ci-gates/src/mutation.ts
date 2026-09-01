import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { isJson, isJsonObject, type Json, type JsonCandidate } from "@hena-dev/core";

import { findJustifiedStrykerDisableLines } from "./comments.ts";
import { isRootSourceBarrel, readTypeScriptFiles, type SourceFile } from "./files.ts";

export interface MutationReportAccess {
  readonly listPackagePaths: (cwd: string) => readonly string[];
  readonly readReport: (path: string) => JsonCandidate;
  readonly readSources: (cwd: string) => readonly SourceFile[];
}

interface MutationReportSummary {
  readonly fileSources: ReadonlyMap<string, string>;
  readonly mutantCount: number;
  readonly projectRoot: string;
}

const testSourcePattern = /\.(?:test|test-d)\.(?:ts|tsx|mts|cts)$/u;
const declarationPattern = /\.d\.(?:ts|mts|cts)$/u;
const recognizedMutators = new Set([
  "ArithmeticOperator",
  "AssignmentOperator",
  "ArrayDeclaration",
  "ArrowFunction",
  "BlockStatement",
  "BooleanLiteral",
  "CallExpression",
  "ConditionalExpression",
  "EqualityOperator",
  "LogicalOperator",
  "MethodExpression",
  "ObjectLiteral",
  "OptionalChaining",
  "Regex",
  "StringLiteral",
  "UnaryOperator",
  "UpdateOperator",
]);
const strykerFrameworkName = "StrykerJS";
const strykerFrameworkVersion = "10.0.0";

const isValidThresholds = (value: Json | undefined): boolean =>
  isJsonObject(value) && value["high"] === 100 && value["low"] === 100 && value["break"] === 100;

const isValidCoordinate = (value: Json | undefined, minimum: number): boolean => {
  const candidate = value as number;
  return Number.isInteger(candidate) && candidate >= minimum;
};

interface ReportPosition {
  readonly column: number;
  readonly line: number;
}

const readPosition = (value: Json | undefined): ReportPosition | undefined => {
  if (
    !isJsonObject(value) ||
    !isValidCoordinate(value["line"], 1) ||
    !isValidCoordinate(value["column"], 1)
  ) {
    return undefined;
  }
  return { column: value["column"] as number, line: value["line"] as number };
};

const isValidLocation = (value: Json | undefined, source: string): boolean => {
  if (!isJsonObject(value)) return false;
  const start = readPosition(value["start"]);
  const end = readPosition(value["end"]);
  if (start === undefined || end === undefined) return false;
  const lines = source.split("\n");
  if (end.line > lines.length) return false;
  if (end.line < start.line || (end.line === start.line && end.column < start.column)) return false;
  return (
    start.column <= lines[start.line - 1]!.length + 1 &&
    end.column <= lines[end.line - 1]!.length + 1
  );
};

const hasMeaningfulReplacement = (
  value: Readonly<Record<string, Json>>,
  source: string,
): boolean => {
  const location = value["location"];
  if (!isJsonObject(location) || typeof value["replacement"] !== "string") return false;
  const start = readPosition(location["start"]) as ReportPosition;
  const end = readPosition(location["end"]) as ReportPosition;
  const lines = source.split("\n");
  const offset = (position: ReportPosition): number =>
    lines.slice(0, position.line - 1).reduce((total, line) => total + line.length + 1, 0) +
    position.column -
    1;
  const startOffset = offset(start);
  const endOffset = offset(end);
  return endOffset > startOffset && value["replacement"] !== source.slice(startOffset, endOffset);
};

const hasValidTestReferences = (
  value: Json | undefined,
  testIds: ReadonlySet<string>,
  required: boolean,
): boolean =>
  value === undefined
    ? !required
    : Array.isArray(value) &&
      (!required || value.length > 0) &&
      value.every((id) => typeof id === "string" && testIds.has(id));

const isValidMutant = (
  value: Json,
  source: string,
  testIds: ReadonlySet<string>,
  justifiedDisableLines: ReadonlySet<number>,
): boolean => {
  if (
    !isJsonObject(value) ||
    typeof value["id"] !== "string" ||
    typeof value["mutatorName"] !== "string" ||
    !recognizedMutators.has(value["mutatorName"]) ||
    !isValidLocation(value["location"], source) ||
    !hasMeaningfulReplacement(value, source)
  ) {
    return false;
  }
  if (value["status"] === "Killed") {
    return (
      hasValidTestReferences(value["killedBy"], testIds, true) &&
      hasValidTestReferences(value["coveredBy"], testIds, false)
    );
  }
  if (value["status"] === "Timeout") {
    return (
      hasValidTestReferences(value["coveredBy"], testIds, true) &&
      hasValidTestReferences(value["killedBy"], testIds, false)
    );
  }
  if (value["status"] !== "Ignored") return false;
  const location = value["location"] as Readonly<Record<string, Json>>;
  const start = readPosition(location["start"]) as ReportPosition;
  return (
    hasValidTestReferences(value["killedBy"], testIds, false) &&
    hasValidTestReferences(value["coveredBy"], testIds, false) &&
    justifiedDisableLines.has(start.line - 1)
  );
};

const readTestIds = (path: string, value: Json | undefined): ReadonlySet<string> => {
  if (!isJsonObject(value)) {
    throw new TypeError(`${path}: mutation report test files must be a JSON object`);
  }
  const testIds = new Set<string>();
  for (const testFile of Object.values(value)) {
    const tests = isJsonObject(testFile) ? testFile["tests"] : undefined;
    if (!isJsonObject(testFile) || !Array.isArray(tests)) {
      throw new TypeError(`${path}: mutation report test file entries are malformed`);
    }
    for (const test of tests) {
      const id = isJsonObject(test) ? test["id"] : undefined;
      if (typeof id !== "string" || id === "" || testIds.has(id)) {
        throw new TypeError(`${path}: mutation report test definitions are malformed`);
      }
      testIds.add(id);
    }
  }
  return testIds;
};

const inspectMutationReport = (path: string, candidate: JsonCandidate): MutationReportSummary => {
  if (!isJson(candidate) || !isJsonObject(candidate)) {
    throw new TypeError(`${path}: mutation report must be a JSON object`);
  }
  const files = candidate["files"];
  if (!isJsonObject(files)) {
    throw new TypeError(`${path}: mutation report files must be a JSON object`);
  }
  const framework = candidate["framework"];
  if (
    candidate["schemaVersion"] !== "1.0" ||
    typeof candidate["projectRoot"] !== "string" ||
    !isValidThresholds(candidate["thresholds"]) ||
    !isJsonObject(framework) ||
    framework["name"] !== strykerFrameworkName ||
    framework["version"] !== strykerFrameworkVersion
  ) {
    throw new TypeError(`${path}: mutation report metadata must match the enforced configuration`);
  }
  const testIds = readTestIds(path, candidate["testFiles"]);
  const fileSources = new Map<string, string>();
  const mutantIds = new Set<string>();
  const mutantCount = Object.entries(files).reduce<number>((count, [filePath, file]) => {
    const mutants = isJsonObject(file) ? file["mutants"] : undefined;
    const source = isJsonObject(file) ? file["source"] : undefined;
    if (
      !isJsonObject(file) ||
      file["language"] !== "typescript" ||
      typeof source !== "string" ||
      !Array.isArray(mutants)
    ) {
      throw new TypeError(`${path}: mutation report file entries are malformed`);
    }
    const normalizedPath = filePath.replaceAll("\\", "/");
    const justifiedDisableLines = findJustifiedStrykerDisableLines(normalizedPath, source);
    if (!mutants.every((mutant) => isValidMutant(mutant, source, testIds, justifiedDisableLines))) {
      throw new TypeError(`${path}: mutation report contains an invalid or surviving mutant`);
    }
    if (fileSources.has(normalizedPath)) {
      throw new TypeError(`${path}: mutation report contains duplicate normalized file paths`);
    }
    for (const mutant of mutants) {
      const id = (mutant as Readonly<Record<string, Json>>)["id"] as string;
      if (mutantIds.has(id)) {
        throw new TypeError(`${path}: mutation report contains duplicate mutant IDs`);
      }
      mutantIds.add(id);
    }
    fileSources.set(normalizedPath, source);
    return count + mutants.length;
  }, 0);
  return { fileSources, mutantCount, projectRoot: candidate["projectRoot"] };
};

export const countMutationReportMutants = (path: string, candidate: JsonCandidate): number =>
  inspectMutationReport(path, candidate).mutantCount;

const liveMutationReportAccess: MutationReportAccess = {
  listPackagePaths: (cwd) =>
    readdirSync(join(cwd, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}`),
  readReport: (path) => JSON.parse(readFileSync(path).toString("utf8")),
  readSources: (cwd) => readTypeScriptFiles(cwd),
};

export const runMutationReportGate = (
  cwd: string,
  access: MutationReportAccess = liveMutationReportAccess,
): number => {
  const sources = access.readSources(cwd);
  const violations = access.listPackagePaths(cwd).flatMap((packagePath) => {
    const reportPath = `${packagePath}/reports/mutation/mutation.json`;
    const report = inspectMutationReport(reportPath, access.readReport(join(cwd, reportPath)));
    const prefix = `${packagePath}/`;
    const expected = sources
      .filter((source) => source.path.startsWith(`${prefix}src/`))
      .map((source) => ({ content: source.content, path: source.path.slice(prefix.length) }))
      .filter(
        (source) =>
          !testSourcePattern.test(source.path) &&
          !declarationPattern.test(source.path) &&
          !isRootSourceBarrel(source.path),
      );
    const expectedByPath = new Map(expected.map((source) => [source.path, source.content]));
    const reported = report.fileSources;
    const missing = expected
      .filter((source) => !reported.has(source.path))
      .map((source) => `${prefix}${source.path}: missing from mutation report`);
    const stale = expected
      .filter((source) => reported.get(source.path) !== source.content)
      .filter((source) => reported.has(source.path))
      .map((source) => `${prefix}${source.path}: mutation report source does not match`);
    const unexpected = [...reported.keys()]
      .filter((path) => !expectedByPath.has(path))
      .map((path) => `${reportPath}: unexpected mutation report file ${path}`);
    const metadata =
      report.projectRoot === resolve(cwd, packagePath)
        ? []
        : [`${reportPath}: projectRoot does not match ${resolve(cwd, packagePath)}`];
    const empty =
      report.mutantCount === 0
        ? [`${packagePath}: mutation report must contain at least one mutant`]
        : [];
    return [...metadata, ...empty, ...missing, ...stale, ...unexpected];
  });
  for (const violation of violations) console.error(violation);
  return violations.length === 0 ? 0 : 1;
};
