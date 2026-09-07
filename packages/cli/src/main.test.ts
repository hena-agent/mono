import { NodeServices } from "@effect/platform-node";
import { Console, Effect, Layer, Stdio } from "effect";
import { expect, it, vi } from "vitest";

vi.mock("@effect/platform-bun", () => ({
  BunServices: {
    layer: Layer.merge(NodeServices.layer, Stdio.layerTest({ args: Effect.sync(() => args) })),
  },
  BunRuntime: { runMain: vi.fn() },
}));
vi.mock("./serve.ts", () => ({ serve: vi.fn(() => Effect.void) }));

import { BunRuntime } from "@effect/platform-bun";
import { serve } from "./serve.ts";
import "./main.ts";
let args = ["serve"];

it("boots the CLI through BunRuntime with the platform services", async () => {
  const program = vi.mocked(BunRuntime.runMain).mock.calls[0]?.[0];
  expect(Effect.isEffect(program)).toBe(true);
  await Effect.runPromise(program as Effect.Effect<void>);
  expect(serve).toHaveBeenCalledWith({ host: "127.0.0.1", port: 4400, cwd: ".", open: false }, [
    "hena",
    "serve",
  ]);
  args = ["--version"];
  const log = vi.fn();
  const services: Console.Console = { ...console, log };
  await Effect.runPromise(
    (program as Effect.Effect<void>).pipe(Effect.provideService(Console.Console, services)),
  );
  expect(log).toHaveBeenCalledWith("hena v0.0.0");
});
