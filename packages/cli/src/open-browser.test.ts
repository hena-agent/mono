import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, Logger, PlatformError } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { ChildProcess } from "effect/unstable/process";
import { vi } from "vitest";

import { openBrowser } from "./open-browser.ts";

it.effect("chooses an opener without mutating process.platform", () =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const exitCode = vi.fn((_command: ChildProcess.Command) =>
      Effect.succeed(ChildProcessSpawner.ExitCode(0)),
    );
    for (const [platform, command] of [
      ["darwin", "open"],
      ["linux", "xdg-open"],
    ] as const) {
      yield* openBrowser("http://localhost:4400", platform).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, { ...spawner, exitCode }),
      );
      expect(exitCode).toHaveBeenLastCalledWith(
        expect.objectContaining({ command, args: ["http://localhost:4400"] }),
      );
    }
    yield* openBrowser("http://localhost:4401").pipe(
      Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, { ...spawner, exitCode }),
    );
    expect(exitCode).toHaveBeenLastCalledWith(
      expect.objectContaining({
        command: process.platform === "darwin" ? "open" : "xdg-open",
        args: ["http://localhost:4401"],
      }),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("warns on nonzero exits and spawn failures, but not on success", () =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const messages: string[] = [];
    const logger = Logger.layer([
      Logger.make(({ message }) => {
        messages.push(String(message));
      }),
    ]);
    for (const [result, warnings] of [
      [Effect.succeed(ChildProcessSpawner.ExitCode(0)), 0],
      [Effect.succeed(ChildProcessSpawner.ExitCode(7)), 1],
      [Effect.fail(PlatformError.badArgument({ module: "ChildProcess", method: "spawn" })), 2],
    ] as const) {
      yield* openBrowser("http://localhost:4400", "linux").pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, {
          ...spawner,
          exitCode: () => result,
        }),
        Effect.provide(logger),
      );
      expect(messages).toHaveLength(warnings);
    }
    expect(messages).toEqual([
      "Open http://localhost:4400 in your browser.",
      "Open http://localhost:4400 in your browser.",
    ]);
  }).pipe(Effect.provide(NodeServices.layer)),
);
