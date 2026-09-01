import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import {
  canonicalStringify,
  isJson,
  isJsonObject,
  type Json,
  type JsonCandidate,
} from "@hena-dev/core";
import { parseDocument } from "yaml";

import { listGitFiles } from "./files.ts";

export interface PinFileAccess {
  readonly listManifestPaths: (cwd: string) => readonly string[];
  readonly listMutationConfigPaths: (cwd: string) => readonly string[];
  readonly listWorkflowPaths: (cwd: string) => readonly string[];
  readonly readText: (path: string) => string;
  readonly vitestConfigPath: string;
}

export interface PinViolation {
  readonly message: string;
  readonly path: string;
}

const dependencyFields = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  "overrides",
  "resolutions",
] as const;
const exactVersionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const expectedMutationConfig = {
  $schema: "../../node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  coverageAnalysis: "perTest",
  htmlReporter: { fileName: "reports/mutation/index.html" },
  ignorePatterns: ["coverage"],
  jsonReporter: { fileName: "reports/mutation/mutation.json" },
  mutate: ["src/**/*.{ts,tsx,mts,cts}", "!src/**/*.{test,test-d}.{ts,tsx,mts,cts}"],
  plugins: ["@stryker-mutator/vitest-runner"],
  reporters: ["clear-text", "progress", "html", "json"],
  testRunner: "vitest",
  thresholds: { break: 100, high: 100, low: 100 },
} as const;
const expectedVitestConfig = `export default {
  test: {
    exclude: [".stryker-tmp/**", "dist/**", "node_modules/**"],
    include: ["src/**/*.test.{ts,tsx,mts,cts}"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx,mts,cts}"],
      exclude: [
        ".stryker-tmp/**",
        "dist/**",
        "src/**/*.test.{ts,tsx,mts,cts}",
        "src/**/*.test-d.{ts,tsx,mts,cts}",
      ],
      thresholds: {
        branches: 100,
        functions: 100,
        lines: 100,
        statements: 100,
      },
    },
  },
};
`;
interface WorkflowInvocation {
  readonly action: string;
  readonly hasInputKeyCollision: boolean;
  readonly inputs: Readonly<Record<string, Json>>;
}

const normalizeWorkflowInputs = (value: Json | undefined): Omit<WorkflowInvocation, "action"> => {
  const entries = isJsonObject(value)
    ? Object.entries(value).map(([name, input]) => [name.toLowerCase(), input] as const)
    : [];
  const normalizedNames = entries.map(([name]) => name);
  return {
    hasInputKeyCollision: new Set(normalizedNames).size !== normalizedNames.length,
    inputs: Object.fromEntries(entries),
  };
};

const readWorkflowInvocation = (value: Json): readonly WorkflowInvocation[] => {
  if (!isJsonObject(value)) return [];
  const uses = value["uses"];
  return typeof uses === "string"
    ? [{ action: uses, ...normalizeWorkflowInputs(value["with"]) }]
    : [];
};

const readStepInvocations = (value: Json | undefined): readonly WorkflowInvocation[] =>
  Array.isArray(value) ? value.flatMap(readWorkflowInvocation) : [];

const collectWorkflowInvocations = (
  candidate: Readonly<Record<string, Json>>,
): readonly WorkflowInvocation[] => {
  const jobs = candidate["jobs"];
  const jobInvocations = isJsonObject(jobs)
    ? Object.values(jobs).flatMap((job) =>
        isJsonObject(job)
          ? [...readWorkflowInvocation(job), ...readStepInvocations(job["steps"])]
          : [],
      )
    : [];
  const runs = candidate["runs"];
  const actionInvocations = isJsonObject(runs) ? readStepInvocations(runs["steps"]) : [];
  return [...jobInvocations, ...actionInvocations];
};

const isExactDependency = (value: string): boolean => {
  const workspaceVersion = value.startsWith("workspace:")
    ? value.slice("workspace:".length)
    : value;
  if (exactVersionPattern.test(workspaceVersion)) {
    return true;
  }
  if (!value.startsWith("npm:")) {
    return false;
  }
  const separator = value.lastIndexOf("@");
  return separator > "npm:".length && exactVersionPattern.test(value.slice(separator + 1));
};

export const findManifestPinViolations = (
  path: string,
  candidate: JsonCandidate,
): readonly PinViolation[] => {
  if (!isJson(candidate) || !isJsonObject(candidate)) {
    throw new TypeError(`${path}: manifest must be a JSON object`);
  }
  const violations: PinViolation[] = [];
  if (path === "package.json" && candidate["packageManager"] !== "bun@1.4.0") {
    violations.push({ message: "packageManager must equal bun@1.4.0", path });
  }

  for (const field of dependencyFields) {
    const dependencies = candidate[field];
    if (dependencies === undefined) {
      continue;
    }
    if (!isJsonObject(dependencies)) {
      throw new TypeError(`${path}: ${field} must be a JSON object`);
    }
    for (const [name, version] of Object.entries(dependencies)) {
      if (typeof version !== "string" || !isExactDependency(version)) {
        violations.push({ message: `${field}.${name} must use an exact version`, path });
      }
    }
  }
  return violations;
};

export const findWorkflowPinViolations = (
  path: string,
  content: string,
): readonly PinViolation[] => {
  const document = parseDocument(content);
  if (document.errors.length > 0) {
    return [{ message: "workflow must be valid YAML", path }];
  }
  const candidate: JsonCandidate = document.toJS();
  if (!isJson(candidate) || !isJsonObject(candidate)) {
    return [{ message: "workflow must be a JSON-shaped YAML object", path }];
  }
  const invocations = collectWorkflowInvocations(candidate);
  const violations = invocations.flatMap(({ action, hasInputKeyCollision }) => [
    ...(action.startsWith("./") || /@[0-9a-f]{40}$/.test(action)
      ? []
      : [{ message: `action ${action} must use a full commit SHA`, path }]),
    ...(hasInputKeyCollision
      ? [{ message: "action with keys must be unique case-insensitively", path }]
      : []),
  ]);
  for (const invocation of invocations) {
    const normalizedAction = invocation.action.toLowerCase();
    if (
      normalizedAction.startsWith("actions/setup-node@") &&
      invocation.inputs["node-version"] !== "24.20.0"
    ) {
      violations.push({ message: "setup-node must pin node-version 24.20.0", path });
    }
    if (
      normalizedAction.startsWith("oven-sh/setup-bun@") &&
      ((invocation.inputs["bun-version"] !== undefined &&
        invocation.inputs["bun-version"] !== "1.4.0") ||
        invocation.inputs["bun-version-file"] !== undefined)
    ) {
      violations.push({ message: "setup-bun bun-version overrides must equal 1.4.0", path });
    }
  }
  if (/(?:^|\/)action\.ya?ml$/u.test(path)) {
    const runs = candidate["runs"];
    if (!isJsonObject(runs) || runs["using"] !== "composite") {
      violations.push({ message: "repository actions must use composite steps", path });
    }
  }
  return violations;
};

export const findMutationConfigPinViolations = (
  path: string,
  candidate: JsonCandidate,
): readonly PinViolation[] => {
  if (!isJson(candidate) || !isJsonObject(candidate)) {
    throw new TypeError(`${path}: Stryker config must be a JSON object`);
  }
  return canonicalStringify(candidate) === canonicalStringify(expectedMutationConfig)
    ? []
    : [{ message: "Stryker must mutate all production source at 100% thresholds", path }];
};

const livePinFileAccess: PinFileAccess = {
  listManifestPaths: (cwd) => [
    "package.json",
    ...readdirSync(join(cwd, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}/package.json`),
  ],
  listMutationConfigPaths: (cwd) =>
    readdirSync(join(cwd, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => `packages/${entry.name}/stryker.config.json`),
  listWorkflowPaths: (cwd) =>
    listGitFiles(cwd, [
      ":(glob).github/workflows/**/*.yml",
      ":(glob).github/workflows/**/*.yaml",
      ":(glob)**/action.yml",
      ":(glob)**/action.yaml",
    ]),
  readText: (path) => readFileSync(path, "utf8"),
  vitestConfigPath: "vitest.config.mjs",
};

export const runPinGate = (cwd: string, access: PinFileAccess = livePinFileAccess): number => {
  const manifestViolations = access
    .listManifestPaths(cwd)
    .flatMap((path) =>
      findManifestPinViolations(path, JSON.parse(access.readText(resolve(cwd, path)))),
    );
  const workflowViolations = access
    .listWorkflowPaths(cwd)
    .flatMap((path) => findWorkflowPinViolations(path, access.readText(resolve(cwd, path))));
  const mutationConfigViolations = access
    .listMutationConfigPaths(cwd)
    .flatMap((path) =>
      findMutationConfigPinViolations(path, JSON.parse(access.readText(resolve(cwd, path)))),
    );
  const vitestConfigViolations =
    access.readText(resolve(cwd, access.vitestConfigPath)) === expectedVitestConfig
      ? []
      : [
          {
            message: "root Vitest config must match the exact pinned coverage contract",
            path: access.vitestConfigPath,
          },
        ];
  const violations = [
    ...manifestViolations,
    ...workflowViolations,
    ...mutationConfigViolations,
    ...vitestConfigViolations,
  ];
  for (const violation of violations) {
    console.error(`${violation.path}: ${violation.message}`);
  }
  return violations.length === 0 ? 0 : 1;
};
