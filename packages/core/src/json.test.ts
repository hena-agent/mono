import { describe, expect, it } from "vitest";

import { isJson, type JsonCandidate } from "./json.ts";

describe("isJson", () => {
  it.each([
    null,
    true,
    42,
    "value",
    [1, "two", false],
    { nested: { value: 1 } },
    { value: null },
    Object.create(null),
  ] satisfies readonly JsonCandidate[])("accepts JSON value %#", (value) => {
    expect(isJson(value)).toBe(true);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    1n,
    Symbol("value"),
    undefined,
    [undefined],
    [1, undefined],
    { nested: undefined },
  ] satisfies readonly JsonCandidate[])("rejects non-JSON value %#", (value) => {
    expect(isJson(value)).toBe(false);
  });

  it("rejects non-plain objects at runtime boundaries", () => {
    // @ts-expect-error This test verifies the runtime boundary.
    expect(isJson(new Date(0))).toBe(false);
  });

  it("rejects accessors and hidden or symbol object state", () => {
    const accessor = {
      get value(): number {
        return 1;
      },
    };
    const hidden: { value?: JsonCandidate } = {};
    const symbolExtended: { value: number } = { value: 1 };
    Object.defineProperty(hidden, "value", { value: 1 });
    Object.defineProperty(symbolExtended, Symbol("extra"), { enumerable: true, value: 2 });

    expect(isJson(accessor)).toBe(false);
    expect(isJson(hidden)).toBe(false);
    expect(isJson(symbolExtended)).toBe(false);
  });

  it("rejects sparse arrays and arrays with named properties", () => {
    const sparse: JsonCandidate[] = new Array(1);
    const extended: JsonCandidate[] = [1];
    const disguisedSparse: JsonCandidate[] = new Array(2);
    const symbolExtended: JsonCandidate[] = [1];
    const hiddenExtended: JsonCandidate[] = [1];
    const subclass = new (class extends Array<JsonCandidate> {})();
    Object.assign(extended, { extra: 2 });
    disguisedSparse[0] = 1;
    Object.assign(disguisedSparse, { extra: 2 });
    Object.defineProperty(symbolExtended, Symbol("extra"), { value: 2 });
    Object.defineProperty(hiddenExtended, "extra", { value: 2 });
    subclass.push(1);

    expect(isJson(sparse)).toBe(false);
    expect(isJson(extended)).toBe(false);
    expect(isJson(disguisedSparse)).toBe(false);
    expect(isJson(symbolExtended)).toBe(false);
    expect(isJson(hiddenExtended)).toBe(false);
    expect(isJson(subclass)).toBe(false);
  });

  it("rejects cycles while allowing shared subobjects", () => {
    const cycle: JsonCandidate[] = [];
    const objectCycle: { [key: string]: JsonCandidate } = {};
    cycle.push(cycle);
    objectCycle["self"] = objectCycle;
    const shared = { value: 1 } as const;
    const sharedArray = [1] as const;

    expect(isJson(cycle)).toBe(false);
    expect(isJson(objectCycle)).toBe(false);
    expect(isJson([shared, shared])).toBe(true);
    expect(isJson([sharedArray, sharedArray])).toBe(true);
  });
});
