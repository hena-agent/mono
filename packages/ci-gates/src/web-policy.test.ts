import { expect, it } from "vitest";

import { findTypeScriptRemappingViolations } from "./production.ts";
import { findWorkspaceScriptViolations } from "./workspaces.ts";
import { findMutationConfigPinViolations } from "./pins.ts";
import { readFileSync } from "node:fs";
import type { JsonCandidate } from "@hena-dev/core";

const scripts = {
  build: "vite build",
  mutation: "stryker run",
  test: "vitest run --root . --config ../../vitest.config.mjs --coverage",
  typecheck: "tsc --noEmit",
};

it("allows only the web package to build with Vite", () => {
  expect(
    findWorkspaceScriptViolations([{ exports: {}, path: "packages/web/package.json", scripts }]),
  ).toEqual([]);
  for (const path of ["packages/web-extra/package.json", "packages/server/package.json"]) {
    expect(findWorkspaceScriptViolations([{ exports: {}, path, scripts }])).toEqual([
      { expected: "rm -rf dist && tsc -p tsconfig.build.json", path, script: "build" },
    ]);
  }
  expect(
    findWorkspaceScriptViolations([
      {
        exports: {},
        path: "packages/web/package.json",
        scripts: { ...scripts, build: "tsc", test: "true" },
      },
    ]),
  ).toEqual([
    { expected: "vite build", path: "packages/web/package.json", script: "build" },
    { expected: scripts.test, path: "packages/web/package.json", script: "test" },
  ]);
});

it("allows only the generated web route tree to be excluded from mutation", () => {
  const base: JsonCandidate = JSON.parse(
    readFileSync(new URL("../stryker.config.json", import.meta.url)).toString(),
  );
  const config = {
    ...(base as object),
    mutate: [
      "src/**/*.{ts,tsx,mts,cts}",
      "!src/**/*.{test,test-d}.{ts,tsx,mts,cts}",
      "!src/routeTree.gen.ts",
    ],
  };
  expect(findMutationConfigPinViolations("packages/web/stryker.config.json", config)).toEqual([]);
  expect(
    findMutationConfigPinViolations("packages/other/stryker.config.json", config),
  ).toHaveLength(1);
  expect(
    findMutationConfigPinViolations("packages/web/stryker.config.json", { ...config, mutate: [] }),
  ).toHaveLength(1);
});

it("permits the shadcn source alias, not arbitrary web remapping or package escapes", () => {
  const content = JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } });
  expect(
    findTypeScriptRemappingViolations([{ path: "packages/web/tsconfig.json", content }]),
  ).toEqual([]);
  for (const path of [
    "tsconfig.json",
    "packages/web-extra/tsconfig.json",
    "packages/server/tsconfig.json",
  ]) {
    expect(findTypeScriptRemappingViolations([{ path, content }])).toHaveLength(1);
  }
  for (const compilerOptions of [
    { paths: { "@/*": ["../server/src/*"] } },
    { paths: { "@/*": ["./src/*"], escape: ["../*"] } },
    { paths: {} },
    { baseUrl: "." },
    { baseUrl: { "@/*": ["./src/*"] } },
    { rootDirs: [] },
    { moduleSuffixes: [] },
  ]) {
    expect(
      findTypeScriptRemappingViolations([
        {
          path: "packages/web/tsconfig.json",
          content: JSON.stringify({ compilerOptions }),
        },
      ]),
    ).toHaveLength(1);
  }
});
