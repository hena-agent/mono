import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JsonCandidate } from "@hena-dev/core";
import { describe, expect, it, vi } from "vitest";

import {
  findManifestPinViolations,
  findMutationConfigPinViolations,
  findWorkflowPinViolations,
  runPinGate,
  type PinFileAccess,
} from "./pins.ts";

interface MutationConfigFixture {
  readonly [key: string]: JsonCandidate;
  readonly mutate: readonly string[];
  readonly reporters: readonly string[];
  readonly thresholds: Readonly<Record<"break" | "high" | "low", number>>;
}

const actionSha = "a".repeat(40);
const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: new URL(".", import.meta.url),
  encoding: "utf8",
}).trim();
const validMutationConfig: MutationConfigFixture = JSON.parse(
  readFileSync(new URL("../stryker.config.json", import.meta.url), "utf8"),
);
const validVitestConfig = readFileSync(join(repositoryRoot, "vitest.config.mjs"), "utf8");
const workflowWithSteps = (steps: string): string =>
  `jobs:\n  checks:\n    runs-on: ubuntu-latest\n    steps:\n${steps
    .split("\n")
    .map((line) => `      ${line}`)
    .join("\n")}\n`;

describe("findManifestPinViolations", () => {
  it("accepts exact, prerelease, workspace, catalog, and npm alias versions", () => {
    expect(
      findManifestPinViolations("package.json", {
        packageManager: "bun@1.4.0",
        catalog: { catalog: "1.2.3" },
        dependencies: {
          alias: "npm:@scope/package@6.0.2",
          catalog: "catalog:",
          release: "12.34.56+build.12",
          prerelease: "4.0.0-rc.112",
          workspace: "workspace:0.0.0",
        },
      }),
    ).toEqual([]);
  });

  it("rejects ranges in every dependency field and an unpinned package manager", () => {
    expect(
      findManifestPinViolations("package.json", {
        packageManager: "bun@latest",
        dependencies: {
          first: "^1.0.0",
          fakePackage: "other@1.2.3",
          invalidBuild: "1.2.3+!",
          malformedAlias: "npm:@1.2.3",
          nonString: false,
          suffix: "1.2.3garbage",
        },
        devDependencies: { second: "~2.0.0" },
        optionalDependencies: { third: "workspace:*" },
        overrides: { fifth: "latest" },
        peerDependencies: { fourth: "npm:package@>=3.0.0" },
        resolutions: { sixth: "^6.0.0" },
        catalog: { seventh: "^7.0.0" },
      }),
    ).toEqual([
      { message: "packageManager must equal bun@1.4.0", path: "package.json" },
      { message: "dependencies.first must use an exact version", path: "package.json" },
      { message: "dependencies.fakePackage must use an exact version", path: "package.json" },
      { message: "dependencies.invalidBuild must use an exact version", path: "package.json" },
      { message: "dependencies.malformedAlias must use an exact version", path: "package.json" },
      { message: "dependencies.nonString must use an exact version", path: "package.json" },
      { message: "dependencies.suffix must use an exact version", path: "package.json" },
      { message: "devDependencies.second must use an exact version", path: "package.json" },
      { message: "optionalDependencies.third must use an exact version", path: "package.json" },
      { message: "peerDependencies.fourth must use an exact version", path: "package.json" },
      { message: "overrides.fifth must use an exact version", path: "package.json" },
      { message: "resolutions.sixth must use an exact version", path: "package.json" },
      { message: "catalog.seventh must use an exact version", path: "package.json" },
    ]);
  });

  it("rejects malformed manifests and dependency fields", () => {
    expect(() => findManifestPinViolations("package.json", [])).toThrow(
      "package.json: manifest must be a JSON object",
    );
    expect(() => findManifestPinViolations("package.json", null)).toThrow(
      "package.json: manifest must be a JSON object",
    );
    expect(() => findManifestPinViolations("package.json", "invalid")).toThrow(
      "package.json: manifest must be a JSON object",
    );
    expect(() =>
      findManifestPinViolations("package.json", {
        packageManager: "bun@1.4.0",
        dependencies: [],
      }),
    ).toThrow("package.json: dependencies must be a JSON object");
  });
});

describe("findMutationConfigPinViolations", () => {
  it("accepts the checked-in Stryker config", () => {
    expect(findMutationConfigPinViolations("stryker.config.json", validMutationConfig)).toEqual([]);
  });

  it("rejects altered source patterns and policy options", () => {
    for (const candidate of [
      { ...validMutationConfig, mutate: {} },
      { ...validMutationConfig, mutate: [...validMutationConfig.mutate, "src/extra.ts"] },
      { ...validMutationConfig, mutate: ["src/a.ts", validMutationConfig.mutate[1]] },
      { ...validMutationConfig, mutate: [validMutationConfig.mutate[0], "!src/a.test.ts"] },
      { ...validMutationConfig, coverageAnalysis: "all" },
      {
        ...validMutationConfig,
        thresholds: { ...validMutationConfig.thresholds, high: 99 },
      },
      { ...validMutationConfig, thresholds: { ...validMutationConfig.thresholds, low: 99 } },
      { ...validMutationConfig, thresholds: { ...validMutationConfig.thresholds, break: 99 } },
      { ...validMutationConfig, incremental: true },
      { ...validMutationConfig, ignoreStatic: true },
      { ...validMutationConfig, testRunner: "command" },
      { ...validMutationConfig, reporters: ["clear-text"] },
    ]) {
      expect(findMutationConfigPinViolations("stryker.config.json", candidate)).toEqual([
        {
          message: "Stryker must mutate all production source at 100% thresholds",
          path: "stryker.config.json",
        },
      ]);
    }
    expect(() => findMutationConfigPinViolations("stryker.config.json", null)).toThrow(
      "stryker.config.json: Stryker config must be a JSON object",
    );
  });
});

describe("findWorkflowPinViolations", () => {
  it("accepts commit-pinned and local actions with the pinned Node runtime", () => {
    const workflow = `${workflowWithSteps(`- name: Node\n  uses: actions/setup-node@${actionSha} # v5\n  with:\n    node-version: 24.20.0\n    bun-version: latest\n- uses: oven-sh/setup-bun@${actionSha}\n- uses: oven-sh/setup-bun@${actionSha}\n  with:\n    bun-version: 1.4.0\n- uses: ./local-action`)}  delegated:\n    uses: owner/repo/.github/workflows/check.yml@${actionSha}\n`;
    expect(findWorkflowPinViolations(".github/workflows/ci.yml", workflow)).toEqual([]);
  });

  it("rejects action tags and missing or changed Node pins", () => {
    expect(
      findWorkflowPinViolations(
        ".github/workflows/ci.yml",
        workflowWithSteps(
          `-   uses:   actions/setup-node@v5\n- uses: owner/action@${actionSha}suffix\n  with:\n    uses: owner/spoof@v1`,
        ),
      ),
    ).toEqual([
      {
        message: "action actions/setup-node@v5 must use a full commit SHA",
        path: ".github/workflows/ci.yml",
      },
      {
        message: `action owner/action@${actionSha}suffix must use a full commit SHA`,
        path: ".github/workflows/ci.yml",
      },
      {
        message: "setup-node must pin node-version 24.20.0",
        path: ".github/workflows/ci.yml",
      },
    ]);
  });

  it("rejects every changed runtime and Bun override", () => {
    const workflow = workflowWithSteps(
      `- uses: actions/setup-node@${actionSha}\n  with:\n    node-version: 24.20.0\n- name: Changed Node\n  uses: actions/setup-node@${actionSha}\n  with:\n    node-version: 20.0.0\n- uses: Actions/setup-node@${actionSha}\n- uses: OVEN-SH/SETUP-BUN@${actionSha}\n  with:\n    bun-version: latest\n- uses: oven-sh/setup-bun@${actionSha}\n  with:\n    bun-version-file: .bun-version`,
    );

    expect(findWorkflowPinViolations(".github/workflows/ci.yml", workflow)).toEqual([
      {
        message: "setup-node must pin node-version 24.20.0",
        path: ".github/workflows/ci.yml",
      },
      {
        message: "setup-node must pin node-version 24.20.0",
        path: ".github/workflows/ci.yml",
      },
      {
        message: "setup-bun bun-version overrides must equal 1.4.0",
        path: ".github/workflows/ci.yml",
      },
      {
        message: "setup-bun bun-version overrides must equal 1.4.0",
        path: ".github/workflows/ci.yml",
      },
    ]);
  });

  it("normalizes action inputs and rejects case-colliding keys", () => {
    const workflow = workflowWithSteps(
      `- uses: actions/setup-node@${actionSha}\n  with:\n    NODE-VERSION: 24.20.0\n- uses: oven-sh/setup-bun@${actionSha}\n  with:\n    BUN-VERSION: latest\n- uses: oven-sh/setup-bun@${actionSha}\n  with:\n    BUN-VERSION-FILE: .bun-version\n- uses: oven-sh/setup-bun@${actionSha}\n  with:\n    bun-version: 1.4.0\n    BUN-VERSION: 1.4.0`,
    );

    expect(findWorkflowPinViolations(".github/workflows/ci.yml", workflow)).toEqual([
      {
        message: "action with keys must be unique case-insensitively",
        path: ".github/workflows/ci.yml",
      },
      {
        message: "setup-bun bun-version overrides must equal 1.4.0",
        path: ".github/workflows/ci.yml",
      },
      {
        message: "setup-bun bun-version overrides must equal 1.4.0",
        path: ".github/workflows/ci.yml",
      },
    ]);
  });

  it("allows workflows without Node and requires composite repository actions", () => {
    expect(
      findWorkflowPinViolations(
        ".github/workflows/ci.yml",
        workflowWithSteps(`- uses: actions/checkout@${actionSha}`),
      ),
    ).toEqual([]);
    expect(
      findWorkflowPinViolations(".github/actions/container/action.yml", "runs:\n  using: docker"),
    ).toEqual([
      {
        message: "repository actions must use composite steps",
        path: ".github/actions/container/action.yml",
      },
    ]);
    expect(findWorkflowPinViolations("action.yml", "runs:\n  using: docker")).toEqual([
      {
        message: "repository actions must use composite steps",
        path: "action.yml",
      },
    ]);
    expect(
      findWorkflowPinViolations(
        ".github/actions/container/action.yml.bak",
        "runs:\n  using: docker",
      ),
    ).toEqual([]);
    expect(
      findWorkflowPinViolations(
        ".github/workflows/ignored.yml",
        `${workflowWithSteps("- null")}  ignored: not-a-job\n`,
      ),
    ).toEqual([]);
  });

  it("rejects malformed or non-object workflow documents", () => {
    expect(findWorkflowPinViolations("ci.yml", "steps: [")).toEqual([
      { message: "workflow must be valid YAML", path: "ci.yml" },
    ]);
    expect(findWorkflowPinViolations("ci.yml", "- uses: ./action")).toEqual([
      { message: "workflow must be a JSON-shaped YAML object", path: "ci.yml" },
    ]);
  });
});

describe("runPinGate", () => {
  const validManifest = JSON.stringify({ packageManager: "bun@1.4.0" });
  const validWorkflow = workflowWithSteps(
    `- uses: actions/checkout@${actionSha}\n- uses: actions/setup-node@${actionSha}\n  with:\n    node-version: 24.20.0`,
  );
  const access = (
    manifest: string,
    workflow: string,
    vitestConfig = validVitestConfig,
  ): PinFileAccess => ({
    listManifestPaths: () => ["package.json"],
    listMutationConfigPaths: () => [],
    listWorkflowPaths: () => [".github/workflows/ci.yml"],
    readText: (path) => {
      if (path === "/repo/package.json") return manifest;
      return path === "/repo/vitest.config.mjs" ? vitestConfig : workflow;
    },
    vitestConfigPath: "vitest.config.mjs",
  });

  it("accepts the checked-in root Vitest config", () => {
    expect(runPinGate("/repo", access(validManifest, validWorkflow))).toBe(0);
  });

  it("prints and fails pin violations", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(
      runPinGate(
        "/repo",
        access(
          JSON.stringify({ packageManager: "bun@latest" }),
          workflowWithSteps("- uses: actions/checkout@v5"),
        ),
      ),
    ).toBe(1);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith("package.json: packageManager must equal bun@1.4.0");
    expect(error).toHaveBeenCalledWith(
      ".github/workflows/ci.yml: action actions/checkout@v5 must use a full commit SHA",
    );
    error.mockRestore();
  });

  it("rejects any change to the exact root Vitest config", () => {
    const changedConfigs = [
      validVitestConfig.replace(
        "    coverage: {",
        '    coverage: {\n      ignoreClassMethods: ["constructor"],',
      ),
      validVitestConfig.replace('provider: "v8"', 'provider: "istanbul"'),
      validVitestConfig.replace(
        'include: ["src/**/*.{ts,tsx,mts,cts}"]',
        'include: ["src/**/*.ts"]',
      ),
      validVitestConfig.replace("lines: 100", "lines: 99"),
    ];
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      for (const changedConfig of changedConfigs) {
        expect(runPinGate("/repo", access(validManifest, validWorkflow, changedConfig))).toBe(1);
      }
      expect(error).toHaveBeenCalledTimes(changedConfigs.length);
      expect(error).toHaveBeenCalledWith(
        "vitest.config.mjs: root Vitest config must match the exact pinned coverage contract",
      );
    } finally {
      error.mockRestore();
    }
  });

  it("discovers manifests and workflows through live adapters", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hena-pins-"));
    const packageDirectory = join(cwd, "packages", "core");
    const workflowDirectory = join(cwd, ".github", "workflows");
    const actionDirectory = join(cwd, ".github", "actions", "wrapper");
    mkdirSync(packageDirectory, { recursive: true });
    mkdirSync(workflowDirectory, { recursive: true });
    mkdirSync(actionDirectory, { recursive: true });
    execFileSync("git", ["init", "--quiet"], { cwd });
    writeFileSync(join(cwd, "package.json"), JSON.stringify({ packageManager: "bun@1.4.0" }));
    writeFileSync(join(cwd, "vitest.config.mjs"), validVitestConfig);
    writeFileSync(join(cwd, "packages", "not-a-package"), "ignored");
    writeFileSync(
      join(packageDirectory, "package.json"),
      JSON.stringify({ dependencies: { invalid: "^1.0.0" } }),
    );
    writeFileSync(
      join(packageDirectory, "stryker.config.json"),
      JSON.stringify({ ...validMutationConfig, coverageAnalysis: "all" }),
    );
    writeFileSync(join(workflowDirectory, "README.md"), "ignored");
    writeFileSync(
      join(workflowDirectory, "ci.yml"),
      workflowWithSteps("- uses: actions/checkout@v5"),
    );
    writeFileSync(join(workflowDirectory, "ci.yml.bak"), "- uses: actions/checkout@v5");
    writeFileSync(
      join(actionDirectory, "action.yml"),
      "runs:\n  using: composite\n  steps:\n    - uses: actions/setup-node@v5",
    );

    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(runPinGate(cwd)).toBe(1);
      expect(error).toHaveBeenCalledTimes(5);
      expect(error).toHaveBeenCalledWith(
        "packages/core/stryker.config.json: Stryker must mutate all production source at 100% thresholds",
      );
    } finally {
      error.mockRestore();
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});
