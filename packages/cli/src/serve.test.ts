import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Logger, Path, PlatformError } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import type { ChildProcess } from "effect/unstable/process";
import { expect, it } from "@effect/vitest";
import { vi } from "vitest";

vi.mock("@effect/platform-bun", () => ({
  BunHttpServer: { layer: vi.fn(() => NodeHttpServer.layerTest) },
}));
vi.mock("@hena-dev/server", async (original) => {
  const actual = await original<typeof import("@hena-dev/server")>();
  return { routes: vi.fn(actual.routes) };
});

import { BunHttpServer } from "@effect/platform-bun";
import { serve } from "./serve.ts";
import { routes } from "@hena-dev/server";

it.live(
  "starts the configured server, serves until interrupted, and opens a browser only on request",
  () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const path = yield* Path.Path;
      const messages: string[] = [];
      const exitCode = vi.fn((_command: ChildProcess.Command) =>
        Effect.succeed(ChildProcessSpawner.ExitCode(0)),
      );
      const logs = Logger.layer([
        Logger.make((entry) => {
          messages.push(String(entry.message));
        }),
      ]);
      const originalPlatform = process.platform;
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          Object.defineProperty(process, "platform", { value: originalPlatform });
        }),
      );
      for (const platform of ["darwin", "linux"]) {
        Object.defineProperty(process, "platform", { value: platform });
        for (const open of [false, true]) {
          const program = serve({ host: "127.0.0.1", port: 4500, cwd: "/tmp", open }).pipe(
            Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, {
              ...spawner,
              exitCode,
            }),
            Effect.provide(logs),
          );
          const fiber = yield* Effect.forkScoped(program);
          yield* Effect.promise(() =>
            vi.waitFor(() =>
              expect(messages.join("\n")).toContain(`Workspace: ${path.resolve("/tmp")}`),
            ),
          );
          yield* Fiber.interrupt(fiber);
          expect(BunHttpServer.layer).toHaveBeenCalledWith({ hostname: "127.0.0.1", port: 4500 });
          expect(routes).toHaveBeenCalledWith(
            yield* path.fromFileUrl(new URL("../../web/dist/client/", import.meta.url)),
          );
          messages.length = 0;
        }
      }
      expect(exitCode).toHaveBeenCalledTimes(2);
      expect(exitCode.mock.calls[0]?.[0]).toMatchObject({
        command: "open",
        args: ["http://127.0.0.1:4500"],
      });
      expect(exitCode.mock.calls[1]?.[0]).toMatchObject({
        command: "xdg-open",
        args: ["http://127.0.0.1:4500"],
      });
      const error = PlatformError.badArgument({
        module: "ChildProcess",
        method: "spawn",
        description: "no opener",
      });
      const fiber = yield* serve({ host: "localhost", port: 4502, cwd: ".", open: true }).pipe(
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, {
          ...spawner,
          exitCode: () => Effect.fail(error),
        }),
        Effect.provide(logs),
        Effect.forkScoped,
      );
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(messages).toContain("Open http://localhost:4502 in your browser.")),
      );
      yield* Fiber.interrupt(fiber);
      vi.restoreAllMocks();
    }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
