import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { findStrykerDisables } from "./comments.ts";
import { readTypeScriptFiles, type SourceFileAccess } from "./files.ts";
import type { MetricsReport } from "./metrics.ts";

const escapeMarkdownCode = (value: string): string =>
  [...value]
    .map((character) => {
      const code = character.charCodeAt(0);
      const isControl =
        code <= 0x1f || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;
      if (character !== "`" && !isControl) return character;
      if (character === "\n") return "\\n";
      if (character === "\r") return "\\r";
      if (character === "\t") return "\\t";
      return `\\u${code.toString(16).padStart(4, "0")}`;
    })
    .join("");

export const renderCiSummary = (
  report: MetricsReport,
  strykerDisables: readonly string[],
): string => {
  const disables =
    strykerDisables.length === 0
      ? "None"
      : strykerDisables.map((item) => `- \`${escapeMarkdownCode(item)}\``).join("\n");

  return `## Quality gates

| Gate | Result |
|---|---:|
| Files analyzed | ${report.analyzedFiles} |
| Max Halstead difficulty | ${report.maxHalsteadDifficulty.toFixed(2)} (< 80) |
| Max cyclomatic complexity | ${report.maxCyclomatic} (< 22) |
| Max cognitive complexity | ${report.maxCognitive} (< 22) |
| Max CRAP | ${report.maxCrap} (< 25; equals CC at 100% coverage) |
| Dead code | 0 |
| Redundant clones | 0 |
| Banned type tokens | 0 |

### Mutation exclusions

${disables}
`;
};

export const writeCiSummary = (
  cwd: string,
  destination?: string,
  sourceAccess?: SourceFileAccess,
): void => {
  const report: MetricsReport = JSON.parse(readFileSync(join(cwd, "reports/metrics.json"), "utf8"));
  const disables = findStrykerDisables(readTypeScriptFiles(cwd, sourceAccess));
  const summary = renderCiSummary(report, disables);

  if (destination === undefined) {
    console.log(summary);
  } else {
    appendFileSync(destination, summary);
  }
};
