import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Exit, Result } from "effect";
import { Command } from "effect/unstable/cli";

import { makeCommand, type ServeOptions } from "./command.ts";

it.effect("serve has zero-config defaults and accepts explicit flags", () =>
  Effect.gen(function* () {
    const calls: ServeOptions[] = [];
    const command = makeCommand((options) =>
      Effect.sync(() => {
        calls.push(options);
      }),
    );
    const run = Command.runWith(command, { version: "0.0.0" });
    yield* run(["serve"]);
    yield* run(["serve", "--host", "localhost", "--port", "4501", "--cwd", "/tmp", "--open"]);
    expect(calls).toEqual([
      { host: "127.0.0.1", port: 4400, cwd: ".", open: false },
      { host: "localhost", port: 4501, cwd: "/tmp", open: true },
    ]);
    expect(command.name).toBe("hena");
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("bare hena and help do not start a server; invalid flags fail", () =>
  Effect.gen(function* () {
    let calls = 0;
    const run = Command.runWith(
      makeCommand(() =>
        Effect.sync(() => {
          calls += 1;
        }),
      ),
      { version: "0.0.0" },
    );
    expect(Result.isFailure(yield* Effect.result(run([])))).toBe(true);
    yield* run(["serve", "--help"]);
    for (const args of [
      ["serve", "--cwd", "/this-path-does-not-exist-hena"],
      ["serve", "--port", "0"],
      ["serve", "--port", "65536"],
      ["serve", "--port", "abc"],
      ["serve", "--bogus"],
      ["nope"],
    ]) {
      expect(Exit.isFailure(yield* Effect.exit(run(args)))).toBe(true);
    }
    expect(calls).toBe(0);
  }).pipe(Effect.provide(NodeServices.layer)),
);
