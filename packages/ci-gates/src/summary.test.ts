import { appendFileSync, readFileSync } from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  readFileSync: vi.fn(),
}));

import type { SourceFileAccess } from "./files.ts";
import type { MetricsReport } from "./metrics.ts";
import { renderCiSummary, writeCiSummary } from "./summary.ts";

const report: MetricsReport = {
  analyzedFiles: 2,
  maxCognitive: 3,
  maxCrap: 4,
  maxCyclomatic: 4,
  maxHalsteadDifficulty: 5.125,
  violations: [],
};

const sourceAccess: SourceFileAccess = {
  listPaths: () => ["src/file.ts"],
  readText: () => ["// Stryker ", "disable next-line all: equivalent"].join(""),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readFileSync).mockReturnValue(JSON.stringify(report));
});

describe("renderCiSummary", () => {
  it("renders metrics without exclusions", () => {
    expect(renderCiSummary(report, [])).toContain("None");
  });

  it("renders mutation exclusions", () => {
    expect(renderCiSummary(report, ["first", "second", "caf\u00e9"])).toContain(
      "- `first`\n- `second`\n- `caf\u00e9`",
    );
  });

  it("escapes Markdown and control characters in mutation exclusions", () => {
    const summary = renderCiSummary(report, [
      "src/forged\n### Forged.ts:1 source",
      "src/file.ts:2 source\r\n| Forged | Row | `code`\u0000\t\u001f\u007f\u0085\u009f\u2028\u2029",
    ]);

    expect(summary).toContain(
      [
        "- `src/forged\\n### Forged.ts:1 source`",
        "- `src/file.ts:2 source\\r\\n| Forged | Row | \\u0060code\\u0060\\u0000\\t\\u001f\\u007f\\u0085\\u009f\\u2028\\u2029`",
      ].join("\n"),
    );
    expect(summary).not.toContain("\n### Forged");
    expect(summary).not.toContain("\r\n| Forged | Row |");
  });
});

describe("writeCiSummary", () => {
  it("appends to the GitHub summary", () => {
    writeCiSummary("/repo", "/summary.md", sourceAccess);

    expect(readFileSync).toHaveBeenCalledWith("/repo/reports/metrics.json", "utf8");
    expect(appendFileSync).toHaveBeenCalledWith(
      "/summary.md",
      expect.stringContaining("Mutation exclusions"),
    );
  });

  it("prints locally without a destination", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    writeCiSummary("/repo", undefined, sourceAccess);

    expect(log).toHaveBeenCalledOnce();
    log.mockRestore();
  });
});
