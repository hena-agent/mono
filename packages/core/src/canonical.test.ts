import { describe, expect, it } from "vitest";

import { canonicalStringify, CanonicalJsonError } from "./canonical.ts";
import type { Json } from "./json.ts";

describe("canonicalStringify", () => {
  it.each([
    [null, "null"],
    [true, "true"],
    [false, "false"],
    [0, "0"],
    [-0, "0"],
    [1.25, "1.25"],
    ['line\nquote"', '"line\\nquote\\\""'],
  ] as const)("encodes %#", (value, expected) => {
    expect(canonicalStringify(value)).toBe(expected);
  });

  it("sorts object keys recursively without whitespace", () => {
    expect(
      canonicalStringify({
        z: [3, { b: true, a: false }],
        a: "first",
      }),
    ).toBe('{"a":"first","z":[3,{"a":false,"b":true}]}');
  });

  it("permits shared array and object values", () => {
    const sharedArray = [1] as const;
    const sharedObject = { value: 2 } as const;

    expect(canonicalStringify([sharedArray, sharedArray])).toBe("[[1],[1]]");
    expect(canonicalStringify({ a: sharedObject, b: sharedObject })).toBe(
      '{"a":{"value":2},"b":{"value":2}}',
    );
  });

  it("encodes null object properties and UTF-8 bytes", () => {
    const encoded = canonicalStringify({ currency: "€", value: null });

    expect(encoded).toBe('{"currency":"€","value":null}');
    expect(Array.from(new TextEncoder().encode(encoded))).toEqual([
      123, 34, 99, 117, 114, 114, 101, 110, 99, 121, 34, 58, 34, 226, 130, 172, 34, 44, 34, 118, 97,
      108, 117, 101, 34, 58, 110, 117, 108, 108, 125,
    ]);
  });

  it("rejects object and array accessors without reading them", () => {
    let objectReads = 0;
    let arrayReads = 0;
    const objectValue = {
      get value(): number {
        objectReads += 1;
        return objectReads === 1 ? 1 : Number.NaN;
      },
    };
    const arrayValue: Json[] = [0];
    Object.defineProperty(arrayValue, "0", {
      enumerable: true,
      get: () => {
        arrayReads += 1;
        return arrayReads === 1 ? 1 : Number.NaN;
      },
    });

    expect(() => canonicalStringify(objectValue)).toThrow(CanonicalJsonError);
    expect(() => canonicalStringify(arrayValue)).toThrow(CanonicalJsonError);
    expect(objectReads).toBe(0);
    expect(arrayReads).toBe(0);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    "rejects invalid number %s",
    (value) => {
      expect(() => canonicalStringify(value)).toThrow(CanonicalJsonError);
    },
  );

  it("reports a typed canonical JSON error", () => {
    expect(() => canonicalStringify(Number.NaN)).toThrow(
      expect.objectContaining({
        message: "Canonical JSON only accepts finite JSON values",
        name: "CanonicalJsonError",
      }),
    );
  });

  it("rejects invalid values that cross an untyped boundary", () => {
    // @ts-expect-error This test verifies the runtime boundary.
    expect(() => canonicalStringify(undefined)).toThrow(CanonicalJsonError);
  });

  it("rejects invalid object properties that cross an untyped boundary", () => {
    // @ts-expect-error This test verifies the runtime boundary.
    expect(() => canonicalStringify({ value: undefined })).toThrow(CanonicalJsonError);
  });

  it("rejects sparse and cyclic arrays that cross an untyped boundary", () => {
    const sparse: Json[] = new Array<Json>(1);
    const cycle: Json[] = [];
    cycle.push(cycle);

    expect(() => canonicalStringify(sparse)).toThrow(CanonicalJsonError);
    expect(() => canonicalStringify(cycle)).toThrow(CanonicalJsonError);
  });

  it("rejects nonfinite accessors and property-bearing arrays", () => {
    const invalidObject = {
      get value(): number {
        return Number.NaN;
      },
    };
    const invalidArray: Json[] = [1];
    Object.defineProperty(invalidArray, Symbol("extra"), { value: 2 });

    expect(() => canonicalStringify(invalidObject)).toThrow(CanonicalJsonError);
    expect(() => canonicalStringify(invalidArray)).toThrow(CanonicalJsonError);
  });

  it("rejects non-plain and cyclic objects at runtime boundaries", () => {
    const cycle: { [key: string]: Json } = {};
    cycle["self"] = cycle;

    expect(() => canonicalStringify(cycle)).toThrow(CanonicalJsonError);
    // @ts-expect-error This test verifies the runtime boundary.
    expect(() => canonicalStringify(new Date(0))).toThrow(CanonicalJsonError);
  });

  it("rejects proxies that can conceal state", () => {
    const proxy = new Proxy(
      { visible: 1 },
      {
        ownKeys: () => ["visible"],
      },
    );

    expect(() => canonicalStringify(proxy)).toThrow(CanonicalJsonError);
  });

  it("rejects state a proxy mutates while removing itself", () => {
    const root: { proxy?: Json; value: number } = { value: 1 };
    root.proxy = new Proxy(
      {},
      {
        getPrototypeOf: () => {
          delete root.proxy;
          root.value = Number.NaN;
          return Object.prototype;
        },
      },
    );

    expect(() => canonicalStringify(root)).toThrow(CanonicalJsonError);
  });
});
