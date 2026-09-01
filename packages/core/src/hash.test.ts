import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import { sha256Hex } from "./hash.ts";

it.effect("hashes canonical bytes with SHA-256", () =>
  Effect.gen(function* () {
    const hash = yield* sha256Hex("abc");
    expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  }),
);

it.effect("pads zero bytes in hexadecimal output", () =>
  Effect.gen(function* () {
    const hash = yield* sha256Hex("");
    expect(hash).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  }),
);
