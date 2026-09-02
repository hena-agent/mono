import { parseSync } from "oxc-parser";

import type { SourceFile, SourceFileAccess } from "./files.ts";
import { readTypeScriptFiles } from "./files.ts";

export interface CommentViolation {
  readonly line: number;
  readonly marker: string;
  readonly path: string;
}

const combine = (...parts: readonly string[]): string => parts.join("");

const expectError = combine("@ts-", "expect-error");
const strykerDisable = combine("Stryker ", "disable");
const justifiedStrykerDisablePattern = new RegExp(
  `^[\t ]*// ${strykerDisable} next-line all: \\S.*$`,
);
const coverageIgnorePattern = new RegExp(
  `(?:${["v8", "c8", "istanbul", "node:coverage"].join("|")})\\s+${combine("ig", "nore")}`,
  "gu",
);

const bannedEverywhere = [
  combine("@ts-", "ignore"),
  combine("@ts-", "nocheck"),
  combine("oxlint-", "disable"),
  combine("eslint-", "disable"),
  combine("ast-grep-", "ignore"),
] as const;

const isTypeTest = (path: string): boolean => /\.(?:test|test-d)\.ts$/.test(path);

export const findJustifiedStrykerDisableLines = (
  path: string,
  source: string,
): ReadonlySet<number> => {
  const lineCommentStarts = new Set(
    parseSync(path, source).comments.map((comment) => comment.start),
  );
  const lines = source.split("\n");
  const justifiedLines = new Set<number>();
  let lineStart = 0;
  for (const [index, line] of lines.entries()) {
    if (justifiedStrykerDisablePattern.test(line)) {
      const commentStart = lineStart + line.indexOf("//");
      if (lineCommentStarts.has(commentStart)) justifiedLines.add(index + 1);
    }
    lineStart += line.length + 1;
  }
  return justifiedLines;
};

const findLineViolations = (
  path: string,
  line: string,
  lineNumber: number,
  hasJustifiedStrykerDisable: boolean,
): readonly CommentViolation[] => {
  const violations = bannedEverywhere
    .filter((marker) => line.includes(marker))
    .map((marker) => ({ line: lineNumber, marker, path }));

  if (line.includes(expectError) && !isTypeTest(path)) {
    violations.push({ line: lineNumber, marker: expectError, path });
  }

  if (line.includes(strykerDisable) && !hasJustifiedStrykerDisable) {
    violations.push({ line: lineNumber, marker: strykerDisable, path });
  }

  return violations;
};

export const scanComments = (files: readonly SourceFile[]): readonly CommentViolation[] =>
  files.flatMap((file) => {
    const justifiedStrykerDisableLines = findJustifiedStrykerDisableLines(file.path, file.content);
    const lineViolations = file.content
      .split("\n")
      .flatMap((line, index) =>
        findLineViolations(file.path, line, index + 1, justifiedStrykerDisableLines.has(index + 1)),
      );
    const coverageViolations = [...file.content.matchAll(coverageIgnorePattern)].map((match) => ({
      line: file.content.slice(0, match.index).split("\n").length,
      marker: match[0].replaceAll(/\s+/gu, " "),
      path: file.path,
    }));
    return [...lineViolations, ...coverageViolations].sort((left, right) => left.line - right.line);
  });

export const findStrykerDisables = (files: readonly SourceFile[]): readonly string[] =>
  files.flatMap((file) => {
    const lines = file.content.split("\n");
    return [...findJustifiedStrykerDisableLines(file.path, file.content)].map(
      (line) => `${file.path}:${line} ${lines[line - 1]!.trim()}`,
    );
  });

export const runCommentGate = (cwd: string, access?: SourceFileAccess): number => {
  const files = readTypeScriptFiles(cwd, access);
  const violations = scanComments(files);

  for (const violation of violations) {
    console.error(`${violation.path}:${violation.line} banned suppression: ${violation.marker}`);
  }

  return violations.length === 0 ? 0 : 1;
};
