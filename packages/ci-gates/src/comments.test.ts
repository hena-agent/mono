import { describe, expect, it, vi } from "vitest";

import { findStrykerDisables, runCommentGate, scanComments } from "./comments.ts";
import type { SourceFile, SourceFileAccess } from "./files.ts";

const marker = (...parts: readonly string[]): string => parts.join("");

describe("scanComments", () => {
  it("finds every banned suppression", () => {
    const markers = [
      marker("@ts-", "ignore"),
      marker("@ts-", "nocheck"),
      marker("oxlint-", "disable"),
      marker("eslint-", "disable"),
      marker("v8 ", "ignore"),
      marker("c8 ", "ignore"),
      marker("istanbul ", "ignore"),
      marker("node:coverage ", "ignore"),
      marker("ast-grep-", "ignore"),
      marker("@ts-", "expect-error"),
      marker("Stryker ", "disable next-line all"),
    ];
    const files: readonly SourceFile[] = [{ content: markers.join("\n"), path: "src/file.ts" }];

    const violations = scanComments(files);
    expect(violations).toHaveLength(markers.length);
    expect(violations[0]).toEqual({
      line: 1,
      marker: markers[0],
      path: "src/file.ts",
    });
    expect(violations.at(-1)).toEqual({
      line: markers.length,
      marker: marker("Stryker ", "disable"),
      path: "src/file.ts",
    });
    expect(violations[7]?.marker).toBe(marker("node:coverage ", "ignore"));
  });

  it("allows negative type assertions in tests and justified mutants", () => {
    const files: readonly SourceFile[] = [
      {
        content: marker("// @ts-", "expect-error assertion"),
        path: "src/file.test.ts",
      },
      {
        content: marker("  // Stryker ", "disable next-line all: equivalent  "),
        path: "src/file.ts",
      },
      {
        content: marker("const value = 1;\n\t// Stryker ", "disable next-line all: later"),
        path: "src/later.ts",
      },
    ];

    expect(scanComments(files)).toEqual([]);
    expect(findStrykerDisables(files)).toEqual([
      marker("src/file.ts:1 // Stryker ", "disable next-line all: equivalent"),
      marker("src/later.ts:2 // Stryker ", "disable next-line all: later"),
    ]);
  });

  it("rejects coverage directives with non-space whitespace", () => {
    const files: readonly SourceFile[] = [
      {
        content: marker("/* v8\t  ", "ignore next */\n/* c8\n", "ignore next */"),
        path: "src/file.ts",
      },
      {
        content: marker("/* istanbul\u00a0", "ignore next */"),
        path: "src/other.ts",
      },
    ];

    expect(scanComments(files)).toEqual([
      { line: 1, marker: marker("v8 ", "ignore"), path: "src/file.ts" },
      { line: 2, marker: marker("c8 ", "ignore"), path: "src/file.ts" },
      { line: 1, marker: marker("istanbul ", "ignore"), path: "src/other.ts" },
    ]);
  });

  it("rejects an empty Stryker reason", () => {
    const files: readonly SourceFile[] = [
      {
        content: marker("// Stryker ", "disable next-line all:   "),
        path: "src/file.ts",
      },
    ];

    expect(scanComments(files)).toHaveLength(1);
  });

  it("requires the reason after the Stryker directive", () => {
    const files: readonly SourceFile[] = [
      {
        content: marker("// prefix: Stryker ", "disable next-line all"),
        path: "src/file.ts",
      },
    ];

    expect(scanComments(files)).toEqual([
      {
        line: 1,
        marker: marker("Stryker ", "disable"),
        path: "src/file.ts",
      },
    ]);
  });

  it("rejects broader disable directives even when justified", () => {
    const files: readonly SourceFile[] = [
      {
        content: marker("// Stryker ", "disable: equivalent"),
        path: "src/file.ts",
      },
    ];

    expect(scanComments(files)).toEqual([
      {
        line: 1,
        marker: marker("Stryker ", "disable"),
        path: "src/file.ts",
      },
    ]);
    expect(findStrykerDisables(files)).toEqual([]);
  });

  it("rejects malformed next-line directives", () => {
    const candidates = [
      marker("//Stryker ", "disable next-line all: reason"),
      marker("/// Stryker ", "disable next-line all: reason"),
      marker("value; // Stryker ", "disable next-line all: reason"),
      marker("/* Stryker ", "disable next-line all: reason */"),
      marker("// Stryker ", "disable next-line all:  reason"),
      marker("// Stryker ", "disable next-line all:reason"),
      marker("// Stryker ", "disable next-line StringLiteral: reason"),
    ];

    for (const content of candidates) {
      expect(scanComments([{ content, path: "src/file.ts" }])).toEqual([
        {
          line: 1,
          marker: marker("Stryker ", "disable"),
          path: "src/file.ts",
        },
      ]);
    }
  });

  it("rejects marker-shaped content that is not an actual line comment", () => {
    const directive = marker("// Stryker ", "disable next-line all: equivalent");
    const files = [
      { content: `const text = \`\n${directive}\n\`;`, path: "src/file.ts" },
      { content: `/*\n${directive}\n*/`, path: "src/block.ts" },
    ];

    expect(scanComments(files)).toEqual([
      {
        line: 2,
        marker: marker("Stryker ", "disable"),
        path: "src/file.ts",
      },
      {
        line: 2,
        marker: marker("Stryker ", "disable"),
        path: "src/block.ts",
      },
    ]);
    expect(findStrykerDisables(files)).toEqual([]);
  });

  it("does not treat suffixed filenames as type tests", () => {
    const files: readonly SourceFile[] = [
      {
        content: marker("// @ts-", "expect-error assertion"),
        path: "src/file.test.ts.extra",
      },
    ];

    expect(scanComments(files)).toEqual([
      {
        line: 1,
        marker: marker("@ts-", "expect-error"),
        path: "src/file.test.ts.extra",
      },
    ]);
  });

  it.each(["file.test.tsx", "file.test-d.tsx", "file.test.mts", "file.test.cts"])(
    "rejects negative type assertions in %s",
    (path) => {
      const files: readonly SourceFile[] = [
        {
          content: marker("// @ts-", "expect-error assertion"),
          path: `src/${path}`,
        },
      ];

      expect(scanComments(files)).toHaveLength(1);
    },
  );

  it("does not treat ordinary prose as a Stryker directive", () => {
    const files: readonly SourceFile[] = [{ content: "disable", path: "src/file.ts" }];

    expect(scanComments(files)).toEqual([]);
  });
});

describe("runCommentGate", () => {
  const access = (content: string): SourceFileAccess => ({
    listPaths: () => ["src/file.ts"],
    readText: () => content,
  });

  it("passes clean files", () => {
    expect(runCommentGate("/repo", access("export const value = 1"))).toBe(0);
  });

  it("prints and fails violations", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(runCommentGate("/repo", access(marker("// @ts-", "ignore")))).toBe(1);
    expect(error).toHaveBeenCalledWith(
      `src/file.ts:1 banned suppression: ${marker("@ts-", "ignore")}`,
    );

    error.mockRestore();
  });
});
