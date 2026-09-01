import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  findProductionScopeViolations,
  findTypeScriptRemappingViolations,
  runProductionScopeGate,
} from "./production.ts";

describe("production scope", () => {
  it("rejects test module references from production source", () => {
    expect(
      findProductionScopeViolations([
        {
          content:
            'export { hidden } from "./hidden.test.ts";\nexport { escaped } from "./escaped.test-d\\u002ets";\nexport const local = 1;\nimport "./allowed.test.ts.extra";\nimport { createRequire } from "node:module";\nconsole.log(local);\nload();\nconst hidden = require("./required.test.ts");\nimport legacy = require("./legacy.test.ts");\nimport("./other.test-d.mts");\nimport("./mapped.test.js");\nimport(`./template.${suffix}`);',
          path: "packages/core/src/live.ts",
        },
        {
          content: 'import { helper } from "./helper.test.ts";',
          path: "packages/core/src/live.test.ts",
        },
        {
          content: 'import { helper } from "./suffixed.test.ts";',
          path: "packages/core/src/live.test.ts.ts",
        },
        {
          content: 'import { helper } from "./prefixed.test.ts";',
          path: "prefix/packages/core/src/live.ts",
        },
      ]),
    ).toEqual([
      {
        message: "production source references test module ./hidden.test.ts",
        path: "packages/core/src/live.ts",
      },
      {
        message: "production source references test module ./escaped.test-d.ts",
        path: "packages/core/src/live.ts",
      },
      {
        message: "CommonJS loaders are not permitted in production source",
        path: "packages/core/src/live.ts",
      },
      {
        message: "CommonJS loaders are not permitted in production source",
        path: "packages/core/src/live.ts",
      },
      {
        message: "CommonJS loaders are not permitted in production source",
        path: "packages/core/src/live.ts",
      },
      {
        message: "dynamic imports are not permitted in production source",
        path: "packages/core/src/live.ts",
      },
      {
        message: "dynamic imports are not permitted in production source",
        path: "packages/core/src/live.ts",
      },
      {
        message: "dynamic imports are not permitted in production source",
        path: "packages/core/src/live.ts",
      },
      {
        message: "production source references test module ./suffixed.test.ts",
        path: "packages/core/src/live.test.ts.ts",
      },
    ]);
  });

  it("rejects both CommonJS module specifiers", () => {
    expect(
      findProductionScopeViolations([
        {
          content: 'import "module";\nimport "node:module";',
          path: "packages/core/src/live.ts",
        },
      ]),
    ).toHaveLength(2);
  });

  it("allows identifiers named require when they are not called", () => {
    expect(
      findProductionScopeViolations([
        {
          content: 'export const require = "label";\nconst alias = require;',
          path: "packages/core/src/live.ts",
        },
      ]),
    ).toEqual([]);
  });

  it("rejects normalized static module targets outside the owning package source", () => {
    expect(
      findProductionScopeViolations([
        {
          content:
            'import "..";\nimport "../inside.ts";\nimport "./deep/../../inside.ts";\nimport "../../outside.ts";\nexport { escaped } from ".\\\\..\\\\..\\\\escaped.ts";\nimport "external/../../../outside.ts";',
          path: "packages/core/src/nested/live.ts",
        },
        { content: 'export * from "..";', path: "packages/core/src/live.ts" },
      ]),
    ).toEqual([
      {
        message: "production source references module outside package src ../../outside.ts",
        path: "packages/core/src/nested/live.ts",
      },
      {
        message: "production source references module outside package src .\\..\\..\\escaped.ts",
        path: "packages/core/src/nested/live.ts",
      },
      {
        message: "production source references module outside package src ..",
        path: "packages/core/src/live.ts",
      },
    ]);
  });

  it("rejects AST-confirmed process builtin loader access", () => {
    expect(
      findProductionScopeViolations([
        {
          content: "const direct = process.getBuiltinMod\\u0075le;",
          path: "packages/core/src/direct.ts",
        },
        {
          content: 'process["getBuiltinMod\\u0075le"]("fs");',
          path: "packages/core/src/computed.ts",
        },
        {
          content:
            'const text = "process.getBuiltinModule";\nother.getBuiltinModule;\nprocess.other;\nprocess["other"];\nprocess[0];\nprocess[getMember()];',
          path: "packages/core/src/allowed.ts",
        },
        {
          content:
            'const { other } = process;\nconst { ["other"]: alias } = process;\nconst { [getKey()]: computed } = process;',
          path: "packages/core/src/allowed-properties.ts",
        },
      ]),
    ).toEqual([
      {
        message: "CommonJS loaders are not permitted in production source",
        path: "packages/core/src/direct.ts",
      },
      {
        message: "CommonJS loaders are not permitted in production source",
        path: "packages/core/src/computed.ts",
      },
    ]);
  });

  it("rejects destructured process builtin loaders", () => {
    expect(
      findProductionScopeViolations([
        {
          content:
            'let uninitialized;\nconst alias = process;\nconst {} = getProcess();\nconst { getBuiltinModule: otherLoader } = other;\nconst { ["other"]: otherComputed } = process;\nconst { ...restOnly } = process;',
          path: "packages/core/src/allowed-destructuring.ts",
        },
        {
          content:
            'const { other, getBuiltinModule: load, ...rest } = process;\nconst { createRequire: make } = load("node:module");\nmake(import.meta.url)("./hidden.test.ts");',
          path: "packages/core/src/direct-destructuring.ts",
        },
        {
          content: 'const { ["getBuiltinModule"]: computed } = process;',
          path: "packages/core/src/computed-destructuring.ts",
        },
      ]),
    ).toEqual([
      {
        message: "CommonJS loaders are not permitted in production source",
        path: "packages/core/src/direct-destructuring.ts",
      },
      {
        message: "CommonJS loaders are not permitted in production source",
        path: "packages/core/src/computed-destructuring.ts",
      },
    ]);
  });

  it("allows declarative barrels and rejects executable barrel code", () => {
    expect(
      findProductionScopeViolations([
        {
          content:
            '// public API\nexport { value, type Value } from "./value.ts";\nexport * from "./other.ts";\nexport * as api from "./api.ts";\nexport   type   { Value }   from   "./types.ts"',
          path: "packages/core/src/index.ts",
        },
        {
          content: "export const nested = 1;",
          path: "packages/core/src/nested/src/index.ts",
        },
        { content: "export const executable = 1;", path: "packages/core/src/index.ts.ts" },
      ]),
    ).toEqual([]);
    expect(
      findProductionScopeViolations([
        { content: "export const hidden = 1;", path: "packages/core/src/index.ts" },
      ]),
    ).toEqual([
      {
        message: "package source barrels may contain only re-exports",
        path: "packages/core/src/index.ts",
      },
    ]);
  });

  it("reports violations through the gate", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const access = {
      listTypeScriptConfigPaths: () => [],
      listPaths: () => ["packages/core/src/index.ts"],
      readText: () => "export const hidden = 1;",
    };

    expect(runProductionScopeGate("/repo", access)).toBe(1);
    expect(error).toHaveBeenCalledWith(
      "packages/core/src/index.ts: package source barrels may contain only re-exports",
    );
    expect(
      runProductionScopeGate("/repo", {
        ...access,
        readText: () => 'export * from "./value.ts";',
      }),
    ).toBe(0);
    error.mockRestore();
  });

  it("rejects parse failures and TypeScript remapping options", () => {
    expect(
      findProductionScopeViolations([{ content: "export {", path: "packages/core/src/live.ts" }]),
    ).toEqual([
      { message: "production source must parse without errors", path: "packages/core/src/live.ts" },
    ]);
    expect(
      findTypeScriptRemappingViolations([
        { content: '{"compilerOptions":{"paths":{}}}', path: "tsconfig.json" },
        { content: '{"compilerOptions":{"baseUrl":"."}}', path: "packages/a/tsconfig.json" },
        { content: '{"compilerOptions":{"rootDirs":[]}}', path: "packages/b/tsconfig.json" },
        {
          content: '{"compilerOptions":{"moduleSuffixes":[]}}',
          path: "packages/c/tsconfig.json",
        },
        {
          content: '{"compilerOptions":{"pa\\u0074hs":{}}}',
          path: "packages/d/tsconfig.json",
        },
        {
          content: '{"paths":{},"compilerOptions":{/* \\"baseUrl\\": */}}',
          path: "packages/e/tsconfig.json",
        },
        { content: '{"compilerOptions":null}', path: "packages/f/tsconfig.json" },
        { content: '{"compilerOptions":[]}', path: "packages/g/tsconfig.json" },
        { content: '{"compilerOptions":"config"}', path: "packages/h/tsconfig.json" },
      ]),
    ).toEqual([
      {
        message: "TypeScript baseUrl/paths/rootDirs/moduleSuffixes remapping is not permitted",
        path: "tsconfig.json",
      },
      {
        message: "TypeScript baseUrl/paths/rootDirs/moduleSuffixes remapping is not permitted",
        path: "packages/a/tsconfig.json",
      },
      {
        message: "TypeScript baseUrl/paths/rootDirs/moduleSuffixes remapping is not permitted",
        path: "packages/b/tsconfig.json",
      },
      {
        message: "TypeScript baseUrl/paths/rootDirs/moduleSuffixes remapping is not permitted",
        path: "packages/c/tsconfig.json",
      },
      {
        message: "TypeScript baseUrl/paths/rootDirs/moduleSuffixes remapping is not permitted",
        path: "packages/d/tsconfig.json",
      },
    ]);
  });

  it("rejects external config inheritance and allows local inheritance", () => {
    expect(
      findTypeScriptRemappingViolations([
        { content: '{"extends":"../../tsconfig.base.json"}', path: "packages/a/tsconfig.json" },
        { content: '{"extends":".\\\\base.json"}', path: "packages/b/tsconfig.json" },
        { content: '{"extends":"."}', path: "packages/c/tsconfig.json" },
        {
          content: '{"extends":"@tsconfig/node24/tsconfig.json"}',
          path: "packages/d/tsconfig.json",
        },
        { content: '{"extends":"shared-config"}', path: "packages/e/tsconfig.json" },
        {
          content: '{"extends":["./local.json","external-config"]}',
          path: "packages/f/tsconfig.json",
        },
        { content: '{"extends":"config/../base.json"}', path: "packages/g/tsconfig.json" },
        { content: '{"extends":[null,"./local.json"]}', path: "packages/h/tsconfig.json" },
        { content: '{"extends":null}', path: "packages/i/tsconfig.json" },
      ]),
    ).toEqual([
      {
        message: "external TypeScript config extends are not permitted",
        path: "packages/d/tsconfig.json",
      },
      {
        message: "external TypeScript config extends are not permitted",
        path: "packages/e/tsconfig.json",
      },
      {
        message: "external TypeScript config extends are not permitted",
        path: "packages/f/tsconfig.json",
      },
      {
        message: "external TypeScript config extends are not permitted",
        path: "packages/g/tsconfig.json",
      },
    ]);
  });

  it("fails closed on TypeScript config parse errors", () => {
    expect(
      findTypeScriptRemappingViolations([
        { content: "{", path: "packages/a/tsconfig.json" },
        { content: "null", path: "packages/b/tsconfig.json" },
        { content: "[]", path: "packages/c/tsconfig.json" },
        { content: '"config"', path: "packages/d/tsconfig.json" },
        { content: "{}", path: "packages/e/tsconfig.json" },
      ]),
    ).toEqual([
      {
        message: "TypeScript config must parse without errors",
        path: "packages/a/tsconfig.json",
      },
      {
        message: "TypeScript config must parse without errors",
        path: "packages/b/tsconfig.json",
      },
      {
        message: "TypeScript config must parse without errors",
        path: "packages/c/tsconfig.json",
      },
      {
        message: "TypeScript config must parse without errors",
        path: "packages/d/tsconfig.json",
      },
    ]);
  });

  it("traverses each local extended config once and rejects invalid discovered configs", () => {
    const contents: Readonly<Record<string, string>> = {
      "base.json": '{"compilerOptions":{}}',
      "base.json.extra.json": '{"compilerOptions":{}}',
      "escape.json": '{"extends":"../../outside"}',
      "external.json": '{"extends":"external-config"}',
      "invalid.json": "{",
      "null.json": "null",
      "parent.json": '{"extends":".."}',
      "primitive.json": "[]",
      "tsconfig.json":
        '{"extends":["./base","./base.json",null,["./nested"],"external-config",".\\\\windows","./base.json.extra"]}',
      "windows.json": '{"compilerOptions":{}}',
    };
    const reads: string[] = [];
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(
        runProductionScopeGate("/repo", {
          listPaths: () => [],
          listTypeScriptConfigPaths: () => [
            "tsconfig.json",
            "escape.json",
            "external.json",
            "invalid.json",
            "null.json",
            "parent.json",
            "primitive.json",
          ],
          readText: (path) => {
            const relativePath = path.slice("/repo/".length);
            reads.push(relativePath);
            return contents[relativePath] ?? "{}";
          },
        }),
      ).toBe(1);
      expect(reads).toEqual([
        "tsconfig.json",
        "escape.json",
        "external.json",
        "invalid.json",
        "null.json",
        "parent.json",
        "primitive.json",
        "base.json",
        "windows.json",
        "base.json.extra.json",
      ]);
    } finally {
      error.mockRestore();
    }
  });

  it("discovers TypeScript config remapping through the live adapter", () => {
    const cwd = mkdtempSync(join(tmpdir(), "hena-production-"));
    mkdirSync(join(cwd, "packages", "core", "src"), { recursive: true });
    writeFileSync(join(cwd, "packages", "core", "src", "live.ts"), "export const live = 1;");
    writeFileSync(join(cwd, "compiler-options.jsonc"), '{"compilerOptions":{"paths":{}}}');
    writeFileSync(join(cwd, "tsconfig.json"), '{"extends":"./compiler-options.jsonc"}');
    writeFileSync(join(cwd, "tsconfig.app.json"), '{"compilerOptions":{"baseUrl":"."}}');
    writeFileSync(join(cwd, "tsconfig.json.bak"), '{"compilerOptions":{"rootDirs":[]}}');
    execFileSync("git", ["init"], { cwd });
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    try {
      expect(runProductionScopeGate(cwd)).toBe(1);
      expect(error).toHaveBeenCalledWith(
        "compiler-options.jsonc: TypeScript baseUrl/paths/rootDirs/moduleSuffixes remapping is not permitted",
      );
      expect(error).toHaveBeenCalledWith(
        "tsconfig.app.json: TypeScript baseUrl/paths/rootDirs/moduleSuffixes remapping is not permitted",
      );
      expect(error).toHaveBeenCalledTimes(2);
    } finally {
      error.mockRestore();
      rmSync(cwd, { force: true, recursive: true });
    }
  });
});
