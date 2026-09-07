import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonCandidate } from "@hena-dev/core";
import { expect, it } from "vitest";
import { parseDocument } from "yaml";

const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const actionPath = join(root, ".github/actions/setup-opencode");
const restoreScript = parseDocument(readFileSync(join(actionPath, "action.yml"), "utf8")).getIn([
  "runs",
  "steps",
  0,
  "run",
]);
if (typeof restoreScript !== "string")
  throw new Error("Credential restore step must be a shell script");

const oauth = {
  type: "oauth",
  access: "test-access",
  refresh: "ci-refresh-disabled",
  expires: 4_000_000_000_000,
};

const restore = (provider: string, auth: JsonCandidate, command = "") => {
  const home = mkdtempSync(join(tmpdir(), "hena-reviewer-auth-"));
  try {
    const result = spawnSync("/bin/bash", ["-c", restoreScript], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: home,
        MODEL: `${provider}/test-model`,
        COMMAND: command,
        OPENCODE_AUTH_JSON: JSON.stringify(auth),
        TIMEOUT_MINUTES: "40",
        GITHUB_ACTION_PATH: actionPath,
      },
    });
    const path = join(home, ".local/share/opencode/auth.json");
    const restored: JsonCandidate = existsSync(path)
      ? JSON.parse(readFileSync(path, "utf8"))
      : undefined;
    return { status: result.status, stdout: result.stdout, restored };
  } finally {
    rmSync(home, { force: true, recursive: true });
  }
};

it("restores review-tool OAuth without requiring a Zen credential", () => {
  expect(
    restore("opencode", { openai: oauth, anthropic: oauth }, "thermo-nuclear-code-quality-review"),
  ).toEqual({ status: 0, stdout: "", restored: { openai: oauth } });
  expect(restore("opencode", {})).toEqual({ status: 0, stdout: "", restored: {} });
});

it.each(["anthropic", "openai", "opencode-go", "opencode-other"])(
  "still requires credentials for %s",
  (provider) => {
    const result = restore(provider, {});
    expect(result.status).toBe(1);
    expect(result.stdout).toContain(
      `valid '${provider}' API key or non-refreshing OAuth credential`,
    );
    expect(result.restored).toBeUndefined();
  },
);

it("preserves valid credentials for authenticated providers", () => {
  expect(restore("anthropic", { anthropic: oauth })).toEqual({
    status: 0,
    stdout: "",
    restored: { anthropic: oauth },
  });
  const api = { type: "api", key: "test-key" };
  expect(restore("opencode-go", { "opencode-go": api })).toEqual({
    status: 0,
    stdout: "",
    restored: { "opencode-go": api },
  });
});

it.each([
  {},
  { openai: { type: "api", key: "test-key" } },
  { openai: { ...oauth, expires: 0 } },
  { openai: { ...oauth, refresh: "live-refresh-token" } },
  { openai: { ...oauth, access: " " } },
])("still requires valid OpenAI OAuth for the Zen review's web-search tool", (auth) => {
  const result = restore("opencode", auth, "thermo-nuclear-code-quality-review");
  expect(result.status).toBe(1);
  expect(result.stdout).toContain("must contain valid OpenAI OAuth");
  expect(result.restored).toBeUndefined();
});
