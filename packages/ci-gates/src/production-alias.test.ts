import { expect, it } from "vitest";

import { findProductionScopeViolations } from "./production.ts";

it.each(["import { value }", "export { value }", "export *"])(
  "checks resolved alias containment for %s",
  (statement) => {
    for (const specifier of [
      "@/../../server/src/status.ts",
      "@/../outside.ts",
      "@/../src-extra/value.ts",
      "@/nested/../../outside.ts",
      "@\\..\\outside.ts",
    ]) {
      const path = "packages/web/src/nested/view.tsx";
      expect(
        findProductionScopeViolations([
          { path, content: `${statement} from ${JSON.stringify(specifier)};` },
        ]),
      ).toEqual([
        { path, message: `production source references module outside package src ${specifier}` },
      ]);
    }
  },
);

it("resolves web aliases from src, not from the importing file", () => {
  for (const specifier of [
    "@/value.ts",
    "@/nested/../value.ts",
    "@/../src/value.ts",
    "@/nested/value.ts",
    "@/",
    "@/.",
  ]) {
    expect(
      findProductionScopeViolations([
        {
          path: "packages/web/src/nested/view.tsx",
          content: `export * from ${JSON.stringify(specifier)};`,
        },
      ]),
    ).toEqual([]);
  }
  expect(
    findProductionScopeViolations([
      {
        path: "packages/web-other/src/view.tsx",
        content: 'export * from "@/../external.ts";',
      },
    ]),
  ).toEqual([]);
  expect(
    findProductionScopeViolations([
      {
        path: "packages/web/src/view.tsx",
        content: 'export * from "@scope/package";',
      },
    ]),
  ).toEqual([]);
});

it("keeps relative web imports subject to their importing directory", () => {
  const path = "packages/web/src/view.tsx";
  expect(
    findProductionScopeViolations([{ path, content: 'export * from "../outside.ts";' }]),
  ).toEqual([
    { path, message: "production source references module outside package src ../outside.ts" },
  ]);
});
