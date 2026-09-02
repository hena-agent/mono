import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { isJson, isJsonObject, type Json, type JsonCandidate } from "@hena-dev/core";

import { isDeclarativeRootBarrel, readTypeScriptFiles } from "./files.ts";

export interface CoverageFileAccess {
  readonly readReport: (path: string) => JsonCandidate;
  readonly readSources: (
    cwd: string,
  ) => readonly { readonly content: string; readonly path: string }[];
}

const packageSourcePattern = /^(packages\/[^/]+)\/src\/.+\.(?:ts|tsx|mts|cts)$/s;
const testSourcePattern = /\.(?:test|test-d)\.(?:ts|tsx|mts|cts)$/;
const counterKeyPattern = /^(?:0|[1-9]\d*)$/u;

const hasSameKeys = (
  left: Readonly<Record<string, Json>>,
  right: Readonly<Record<string, Json>>,
): boolean => {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => Object.hasOwn(right, key));
};

const isCounterKey = (key: string): boolean => {
  if (!counterKeyPattern.test(key)) return false;
  return Number.isSafeInteger(Number(key));
};

const isPositiveSafeInteger = (value: Json | undefined): value is number =>
  Number.isSafeInteger(value) && Number(value) > 0;

const readPosition = (
  value: Json | undefined,
  lineLengths: readonly number[],
  allowEndOfLine: boolean,
): readonly [line: number, column: number] | undefined => {
  if (!isJsonObject(value)) return undefined;
  const line = value["line"];
  const column = value["column"];
  if (!Number.isSafeInteger(line)) return undefined;
  const lineNumber = Number(line);
  const lineLength = lineLengths[lineNumber - 1];
  if (lineLength === undefined) return undefined;
  // ast-v8-to-istanbul's Infinity end-column sentinel serializes to JSON null.
  if (column === null) return allowEndOfLine ? [lineNumber, lineLength] : undefined;
  if (!Number.isSafeInteger(column) || Number(column) < 0) return undefined;
  const columnNumber = Number(column);
  if (columnNumber > lineLength) return undefined;
  return [lineNumber, columnNumber];
};

const readLocation = (
  value: Json | undefined,
  lineLengths: readonly number[],
):
  | { readonly end: readonly [number, number]; readonly start: readonly [number, number] }
  | undefined => {
  if (!isJsonObject(value)) return undefined;
  const start = readPosition(value["start"], lineLengths, false);
  const end = readPosition(value["end"], lineLengths, true);
  if (start === undefined || end === undefined) return undefined;
  if (start[0] > end[0] || (start[0] === end[0] && start[1] > end[1])) return undefined;
  return { end, start };
};

const isImplicitElseLocation = (value: Json): boolean => {
  if (!isJsonObject(value) || Object.keys(value).length !== 2) return false;
  const start = value["start"];
  const end = value["end"];
  return (
    isJsonObject(start) &&
    Object.keys(start).length === 0 &&
    isJsonObject(end) &&
    Object.keys(end).length === 0
  );
};

const isFunctionMetadata = (value: Json | undefined, lineLengths: readonly number[]): boolean => {
  if (!isJsonObject(value) || typeof value["name"] !== "string" || value["name"].length === 0) {
    return false;
  }
  const declaration = readLocation(value["decl"], lineLengths);
  const body = readLocation(value["loc"], lineLengths);
  return declaration !== undefined && body !== undefined && value["line"] === body.start[0];
};

const isBranchMetadata = (
  value: Json | undefined,
  count: number,
  lineLengths: readonly number[],
): boolean => {
  if (!isJsonObject(value) || typeof value["type"] !== "string" || value["type"].length === 0) {
    return false;
  }
  const location = readLocation(value["loc"], lineLengths);
  const locations = value["locations"];
  return (
    location !== undefined &&
    value["line"] === location.start[0] &&
    Array.isArray(locations) &&
    locations.length === count &&
    locations.every(
      (branchLocation, index) =>
        readLocation(branchLocation, lineLengths) !== undefined ||
        // ast-v8-to-istanbul has no source range for an absent else arm.
        (value["type"] === "if" &&
          locations.length === 2 &&
          index === 1 &&
          isImplicitElseLocation(branchLocation)),
    )
  );
};

const isFullyCovered = (value: Json, path: string, content: string, cwd: string): boolean => {
  if (!isJsonObject(value)) return false;
  const statements = value["s"];
  const functions = value["f"];
  const branches = value["b"];
  const statementMap = value["statementMap"];
  const functionMap = value["fnMap"];
  const branchMap = value["branchMap"];
  const lineLengths = content.split(/\r\n|[\n\r]/u).map((line) => line.length);
  return (
    typeof value["path"] === "string" &&
    normalizePath(relative(cwd, value["path"])) === path &&
    isJsonObject(statements) &&
    isJsonObject(statementMap) &&
    hasSameKeys(statements, statementMap) &&
    Object.entries(statements).every(
      ([key, count]) =>
        isCounterKey(key) &&
        isPositiveSafeInteger(count) &&
        readLocation(statementMap[key], lineLengths) !== undefined,
    ) &&
    isJsonObject(functions) &&
    isJsonObject(functionMap) &&
    hasSameKeys(functions, functionMap) &&
    Object.entries(functions).every(
      ([key, count]) =>
        isCounterKey(key) &&
        isPositiveSafeInteger(count) &&
        isFunctionMetadata(functionMap[key], lineLengths),
    ) &&
    isJsonObject(branches) &&
    isJsonObject(branchMap) &&
    hasSameKeys(branches, branchMap) &&
    Object.entries(branches).every(
      ([key, counts]) =>
        isCounterKey(key) &&
        Array.isArray(counts) &&
        counts.length > 0 &&
        counts.every(isPositiveSafeInteger) &&
        isBranchMetadata(branchMap[key], counts.length, lineLengths),
    ) &&
    (Object.keys(statements).length > 0 ||
      Object.keys(functions).length > 0 ||
      Object.keys(branches).length > 0 ||
      isDeclarativeRootBarrel(path, content))
  );
};

const normalizePath = (path: string): string => path.replaceAll("\\", "/");

const liveCoverageFileAccess: CoverageFileAccess = {
  readReport: (path) => JSON.parse(readFileSync(path).toString("utf8")),
  readSources: readTypeScriptFiles,
};

export const findMissingCoverageFiles = (
  sourcePaths: readonly string[],
  reportedPaths: readonly string[],
): readonly string[] => {
  const reported = new Set(reportedPaths);
  return sourcePaths.filter((path) => !reported.has(path));
};

export const runCoverageFileGate = (
  cwd: string,
  access: CoverageFileAccess = liveCoverageFileAccess,
): number => {
  const packageSources = access.readSources(cwd).flatMap((source) => {
    const packagePath = packageSourcePattern.exec(source.path)?.[1];
    return packagePath === undefined || testSourcePattern.test(source.path)
      ? []
      : [{ ...source, packagePath }];
  });
  const packagePaths = [...new Set(packageSources.map((source) => source.packagePath))];
  const violations = packagePaths.flatMap((packagePath) => {
    const reportPath = join(cwd, packagePath, "coverage", "coverage-final.json");
    const report = access.readReport(reportPath);
    if (!isJson(report) || !isJsonObject(report)) {
      throw new TypeError(`${packagePath}/coverage/coverage-final.json must be a JSON object`);
    }
    const sources = packageSources.filter((source) => source.packagePath === packagePath);
    const sourcePaths = sources.map((source) => source.path);
    const reportedEntries = Object.entries(report).map(
      ([path, value]) => [normalizePath(relative(cwd, path)), value] as const,
    );
    const reportedPaths = reportedEntries.map(([path]) => path);
    const reported = new Map(reportedEntries);
    const sourcePathSet = new Set(sourcePaths);
    const reportViolations = reportedPaths.flatMap((path, index) =>
      reportedPaths.indexOf(path) !== index
        ? [`${path}: duplicate normalized path in coverage report`]
        : sourcePathSet.has(path)
          ? []
          : [`${path}: unexpected file in ${packagePath} coverage report`],
    );
    const sourceViolations = sources.flatMap((source) => {
      const entry = reported.get(source.path);
      if (entry === undefined) return [`${source.path}: missing from coverage report`];
      return isFullyCovered(entry, source.path, source.content, cwd)
        ? []
        : [`${source.path}: coverage report is malformed or below 100%`];
    });
    return [...reportViolations, ...sourceViolations];
  });

  for (const violation of violations) console.error(violation);

  return violations.length === 0 ? 0 : 1;
};
