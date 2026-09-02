import { describe, expect, it, vi } from "vitest";

import type { JsonCandidate } from "@hena-dev/core";

import { countMutationReportMutants } from "./mutation.ts";

const position = { column: 1, line: 1 } as const;
const endPosition = { column: 2, line: 1 } as const;

const mutant = {
  coveredBy: ["test-1"],
  id: "1",
  killedBy: ["test-1"],
  location: {
    end: endPosition,
    start: position,
  },
  mutatorName: "StringLiteral",
  replacement: '"changed"',
  status: "Killed",
} as const;

const report = (files: Readonly<Record<string, JsonCandidate>>): JsonCandidate => ({
  files,
  framework: { name: "StrykerJS", version: "10.0.0" },
  projectRoot: "/repo/packages/core",
  schemaVersion: "1.0",
  testFiles: { "src/a.test.ts": { tests: [{ id: "test-1", name: "kills mutant" }] } },
  thresholds: { break: 100, high: 100, low: 100 },
});

const reportWith = (
  changes: Readonly<Record<string, JsonCandidate>>,
  files: Readonly<Record<string, JsonCandidate>> = {},
): JsonCandidate => ({
  files,
  framework: { name: "StrykerJS", version: "10.0.0" },
  projectRoot: "/repo/packages/core",
  schemaVersion: "1.0",
  testFiles: { "src/a.test.ts": { tests: [{ id: "test-1", name: "kills mutant" }] } },
  thresholds: { break: 100, high: 100, low: 100 },
  ...changes,
});

const file = (
  mutants: readonly JsonCandidate[],
  changes: Readonly<Record<string, JsonCandidate>> = {},
): JsonCandidate => ({
  language: "typescript",
  mutants,
  source: "export const value = 1;",
  ...changes,
});

type TestLocation = {
  readonly end: { readonly column: number; readonly line: number };
  readonly start: { readonly column: number; readonly line: number };
};

const switchingLocation = (validation: TestLocation, replacement: TestLocation): TestLocation => {
  const reads = { end: 0, start: 0 };
  return new Proxy(validation, {
    get: (target, key, receiver) => {
      if (key === "end" || key === "start") {
        const read = reads[key]++;
        return read < 2 ? target[key] : replacement[key];
      }
      return Reflect.get(target, key, receiver);
    },
  });
};

const countMutant = (candidate: JsonCandidate, source = "export const value = 1;"): number =>
  countMutationReportMutants("report.json", report({ "src/a.ts": file([candidate], { source }) }));

const expectInvalidMutant = (candidate: JsonCandidate, source?: string): void => {
  expect(() => countMutant(candidate, source)).toThrow(
    "report.json: mutation report contains an invalid or surviving mutant",
  );
};

describe("countMutationReportMutants", () => {
  it("counts valid killed mutants across files", () => {
    expect(
      countMutationReportMutants(
        "report.json",
        report({
          "src/a.ts": file([mutant, { ...mutant, id: "2", status: "Timeout" }]),
          "src/b.ts": file([{ ...mutant, id: "3" }]),
        }),
      ),
    ).toBe(3);
  });

  it("rejects malformed report roots and metadata", () => {
    for (const candidate of [[], null, "invalid"]) {
      expect(() => countMutationReportMutants("report.json", candidate)).toThrow(
        "report.json: mutation report must be a JSON object",
      );
    }
    for (const candidate of [{}, { files: null }, { files: "invalid" }]) {
      expect(() => countMutationReportMutants("report.json", candidate)).toThrow(
        "report.json: mutation report files must be a JSON object",
      );
    }
    expect(() => countMutationReportMutants("report.json", { files: {} })).toThrow(
      "report.json: mutation report metadata must match the enforced configuration",
    );
    for (const candidate of [
      reportWith({ schemaVersion: "2.0" }),
      reportWith({ projectRoot: null }),
      reportWith({ framework: null }),
      reportWith({ framework: { name: "Other", version: "10.0.0" } }),
      reportWith({ framework: { name: "StrykerJS", version: "10.0.1" } }),
      reportWith({ thresholds: null }),
      reportWith({ thresholds: { break: 100, high: 99, low: 100 } }),
      reportWith({ thresholds: { break: 100, high: 100, low: 99 } }),
      reportWith({ thresholds: { break: 99, high: 100, low: 100 } }),
    ]) {
      expect(() => countMutationReportMutants("report.json", candidate)).toThrow(
        "report.json: mutation report metadata must match the enforced configuration",
      );
    }
  });

  it("rejects malformed file entries and mutant outcomes", () => {
    for (const entry of [
      {},
      [],
      file([], { language: "javascript" }),
      file([], { source: null }),
      { language: "typescript", mutants: null, source: "source" },
    ]) {
      expect(() =>
        countMutationReportMutants("report.json", report({ "src/a.ts": entry })),
      ).toThrow("report.json: mutation report file entries are malformed");
    }
    for (const invalid of [
      null,
      {},
      { ...mutant, id: null },
      { ...mutant, mutatorName: null },
      { ...mutant, replacement: null },
      { ...mutant, status: "Survived" },
      { ...mutant, location: null },
      { ...mutant, location: { end: endPosition, start: null } },
      { ...mutant, location: { end: null, start: position } },
      { ...mutant, location: { end: endPosition, start: { ...position, line: "1" } } },
      { ...mutant, location: { end: endPosition, start: { ...position, line: 1.5 } } },
      { ...mutant, location: { end: endPosition, start: { ...position, line: 0 } } },
      { ...mutant, location: { end: endPosition, start: { ...position, column: "0" } } },
      { ...mutant, location: { end: endPosition, start: { ...position, column: 0.5 } } },
      { ...mutant, location: { end: endPosition, start: { ...position, column: 0 } } },
      { ...mutant, location: { end: endPosition, start: { ...position, column: -1 } } },
      {
        ...mutant,
        location: { end: { column: 1, line: 2 }, start: { column: 1, line: 2 } },
      },
      {
        ...mutant,
        location: { end: { column: 999, line: 1 }, start: position },
      },
      {
        ...mutant,
        location: { end: endPosition, start: { column: 3, line: 1 } },
      },
      { ...mutant, mutatorName: "InventedMutator" },
      { ...mutant, replacement: "e" },
      { ...mutant, location: { end: position, start: position } },
      { ...mutant, status: "Ignored" },
    ]) {
      expect(() =>
        countMutationReportMutants("report.json", report({ "src/a.ts": file([invalid]) })),
      ).toThrow("report.json: mutation report contains an invalid or surviving mutant");
    }
    expect(() =>
      countMutationReportMutants(
        "report.json",
        report({ "src/a.ts": file([mutant, { ...mutant, status: "Survived" }]) }),
      ),
    ).toThrow("report.json: mutation report contains an invalid or surviving mutant");

    const multilineSource = "a\nb";
    for (const invalid of [
      { ...mutant, location: { end: endPosition, start: { column: 1, line: 2 } } },
      { ...mutant, location: { end: { column: 1, line: 3 }, start: position } },
      {
        ...mutant,
        location: { end: { column: 1, line: 2 }, start: { column: 3, line: 1 } },
      },
    ]) {
      expect(() =>
        countMutationReportMutants(
          "report.json",
          report({ "src/a.ts": file([invalid], { source: multilineSource }) }),
        ),
      ).toThrow("report.json: mutation report contains an invalid or surviving mutant");
    }
    for (const location of [
      { end: { column: 2, line: 1 }, start: position },
      { end: { column: 1, line: 2 }, start: position },
      { end: { column: 1, line: 2 }, start: { column: 2, line: 1 } },
    ]) {
      expect(
        countMutationReportMutants(
          "report.json",
          report({ "src/a.ts": file([{ ...mutant, location }], { source: multilineSource }) }),
        ),
      ).toBe(1);
    }
    const justifiedDisable = ["// Stryker ", "disable next-line all: equivalent"].join("");
    expect(
      countMutationReportMutants(
        "report.json",
        report({
          "src/a.ts": file(
            [
              {
                ...mutant,
                location: {
                  end: { column: 2, line: 2 },
                  start: { column: 1, line: 2 },
                },
                status: "Ignored",
              },
            ],
            { source: `${justifiedDisable}\nexport const value = 1;` },
          ),
        }),
      ),
    ).toBe(1);
    expect(() =>
      countMutationReportMutants(
        "report.json",
        report({
          "src/a.ts": file([mutant]),
          "src/b.ts": file([mutant]),
        }),
      ),
    ).toThrow("report.json: mutation report contains duplicate mutant IDs");
    expect(() =>
      countMutationReportMutants(
        "report.json",
        report({
          "src\\a.ts": file([mutant]),
          "src/a.ts": file([{ ...mutant, id: "2" }]),
        }),
      ),
    ).toThrow("report.json: mutation report contains duplicate normalized file paths");
  });

  it("requires well-formed report test definitions", () => {
    expect(() =>
      countMutationReportMutants("report.json", reportWith({ testFiles: null })),
    ).toThrow("report.json: mutation report test files must be a JSON object");
    for (const testFiles of [{ "src/a.test.ts": null }, { "src/a.test.ts": { tests: null } }]) {
      expect(() => countMutationReportMutants("report.json", reportWith({ testFiles }))).toThrow(
        "report.json: mutation report test file entries are malformed",
      );
    }
    for (const testFiles of [
      { "src/a.test.ts": { tests: [null] } },
      { "src/a.test.ts": { tests: [{ id: "" }] } },
      {
        "src/a.test.ts": { tests: [{ id: "test-1" }] },
        "src/b.test.ts": { tests: [{ id: "test-1" }] },
      },
    ]) {
      expect(() => countMutationReportMutants("report.json", reportWith({ testFiles }))).toThrow(
        "report.json: mutation report test definitions are malformed",
      );
    }
  });

  it("requires report-backed evidence for killed and timeout mutants", () => {
    const { killedBy: omittedKilledBy, ...withoutKilledBy } = mutant;
    const { coveredBy: omittedCoveredBy, ...withoutCoveredBy } = mutant;
    expect(omittedKilledBy).toEqual(["test-1"]);
    expect(omittedCoveredBy).toEqual(["test-1"]);

    for (const invalid of [
      withoutKilledBy,
      { ...mutant, killedBy: [] },
      { ...mutant, killedBy: ["unknown-test"] },
      { ...mutant, killedBy: ["test-1", "unknown-test"] },
      { ...mutant, coveredBy: ["unknown-test"] },
      { ...withoutCoveredBy, status: "Timeout" },
      { ...mutant, coveredBy: [], status: "Timeout" },
      { ...mutant, coveredBy: ["unknown-test"], status: "Timeout" },
      { ...mutant, killedBy: ["unknown-test"], status: "Timeout" },
    ]) {
      expectInvalidMutant(invalid);
    }

    expect(countMutant(withoutCoveredBy)).toBe(1);
    expect(countMutant({ ...withoutKilledBy, coveredBy: ["test-1"], status: "Timeout" })).toBe(1);

    const originalSetHas = Set.prototype.has;
    const setHas = vi
      .spyOn(Set.prototype, "has")
      .mockImplementation(function (this: Set<string | null>, value) {
        return value === null || originalSetHas.call(this, value);
      });
    try {
      expectInvalidMutant({ ...mutant, killedBy: [null] });
    } finally {
      setHas.mockRestore();
    }
  });

  it("accepts every recognized mutator name", () => {
    for (const mutatorName of [
      "ArithmeticOperator",
      "AssignmentOperator",
      "ArrayDeclaration",
      "ArrowFunction",
      "BlockStatement",
      "BooleanLiteral",
      "CallExpression",
      "ConditionalExpression",
      "EqualityOperator",
      "LogicalOperator",
      "MethodExpression",
      "ObjectLiteral",
      "OptionalChaining",
      "Regex",
      "StringLiteral",
      "UnaryOperator",
      "UpdateOperator",
    ]) {
      expect(countMutant({ ...mutant, mutatorName })).toBe(1);
    }
  });

  it("rejects a location value before reading its positions", () => {
    const location = { end: endPosition, start: position };
    const originalIsArray = Array.isArray;
    let locationChecks = 0;
    const isArray = vi
      .spyOn(Array, "isArray")
      .mockImplementation((value) =>
        value === location ? locationChecks++ === 1 : originalIsArray(value),
      );
    try {
      expectInvalidMutant({ ...mutant, location });
    } finally {
      isArray.mockRestore();
    }
  });

  it("enforces location ordering and source boundary columns", () => {
    const meaningfulLocation = {
      end: { column: 2, line: 1 },
      start: { column: 1, line: 1 },
    };
    const source = "a\nb";

    for (const invalidLocation of [
      {
        end: { column: 2, line: 1 },
        start: { column: 1, line: 2 },
      },
      {
        end: { column: 1, line: 1 },
        start: { column: 2, line: 1 },
      },
    ]) {
      expectInvalidMutant(
        { ...mutant, location: switchingLocation(invalidLocation, meaningfulLocation) },
        source,
      );
    }

    expect(
      countMutant(
        {
          ...mutant,
          location: switchingLocation({ end: position, start: position }, meaningfulLocation),
        },
        source,
      ),
    ).toBe(1);
    expectInvalidMutant(
      {
        ...mutant,
        location: {
          end: { column: 2, line: 2 },
          start: { column: 3, line: 1 },
        },
      },
      source,
    );
  });

  it("requires an exact disable comment on the immediately preceding line", () => {
    const directive = ["// Stryker ", "disable next-line all: equivalent"].join("");
    const ignored = {
      ...mutant,
      location: { end: { column: 2, line: 2 }, start: { column: 1, line: 2 } },
      status: "Ignored",
    };
    for (const source of [
      `ordinary text\nvalue`,
      `${directive}\n\nvalue`,
      `const prefix = 1; ${directive}\nvalue`,
      `/* ${directive} */\nvalue`,
      `// Stryker ${"disable"} all: equivalent\nvalue`,
      `// Stryker ${"disable"} next-line all:  equivalent\nvalue`,
      `// Stryker ${"disable"} next-line all:\nvalue`,
    ]) {
      expectInvalidMutant(ignored, source);
    }
    const validSource = `\t${directive}\nvalue`;
    const {
      coveredBy: omittedCoveredBy,
      killedBy: omittedKilledBy,
      ...ignoredWithoutEvidence
    } = ignored;
    expect(omittedCoveredBy).toEqual(["test-1"]);
    expect(omittedKilledBy).toEqual(["test-1"]);
    expect(countMutant(ignoredWithoutEvidence, validSource)).toBe(1);
    expectInvalidMutant({ ...ignored, killedBy: ["unknown-test"] }, validSource);
    expectInvalidMutant({ ...ignored, coveredBy: ["unknown-test"] }, validSource);
    expectInvalidMutant({ ...ignored, status: "Survived" }, validSource);
  });

  it("does not accept marker-shaped template literal content as a comment", () => {
    const directive = ["// Stryker ", "disable next-line all: equivalent"].join("");
    const source = `const text = \`\n${directive}\nvalue\n\`;`;
    expectInvalidMutant(
      {
        ...mutant,
        location: { end: { column: 2, line: 3 }, start: { column: 1, line: 3 } },
        status: "Ignored",
      },
      source,
    );
  });

  it("uses source lines to locate the replaced text", () => {
    expect(
      countMutant(
        {
          ...mutant,
          location: {
            end: { column: 2, line: 2 },
            start: { column: 1, line: 2 },
          },
          replacement: "c",
        },
        "abc\nd",
      ),
    ).toBe(1);
  });

  it("requires a string mutator name and justified Ignored status", () => {
    let mutatorNameReads = 0;
    const changingMutatorName = new Proxy(
      { ...mutant },
      {
        get: (target, key, receiver) => {
          if (key === "mutatorName") {
            mutatorNameReads += 1;
            return mutatorNameReads === 1 ? "StringLiteral" : null;
          }
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const originalSetHas = Set.prototype.has;
    const setHas = vi
      .spyOn(Set.prototype, "has")
      .mockImplementation(function (this: Set<string | null>, value) {
        return value === null || originalSetHas.call(this, value);
      });
    try {
      expectInvalidMutant(changingMutatorName);
    } finally {
      setHas.mockRestore();
    }
    expectInvalidMutant(
      { ...mutant, status: "Survived" },
      ["// Stryker ", "disable next-line all: equivalent\nexport const value = 1;"].join(""),
    );
  });
});
