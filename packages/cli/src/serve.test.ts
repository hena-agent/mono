import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { Effect, Fiber, Logger, Path } from "effect";
import { expect, it } from "@effect/vitest";
import { vi } from "vitest";

vi.mock("@effect/platform-bun", () => ({
  BunHttpServer: { layer: vi.fn(() => NodeHttpServer.layerTest) },
}));
vi.mock("@hena-dev/server", async (original) => {
  const actual = await original<typeof import("@hena-dev/server")>();
  return { routes: vi.fn(actual.routes) };
});
vi.mock("./open-browser.ts", () => ({ openBrowser: vi.fn(() => Effect.void) }));

import { BunHttpServer } from "@effect/platform-bun";
import { serve } from "./serve.ts";
import { openBrowser } from "./open-browser.ts";
import { routes } from "@hena-dev/server";

it.live("starts the server and opens a browser only after listening when requested", () =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const messages: string[] = [];
    const logs = Logger.layer([
      Logger.make(({ message }) => {
        messages.push(String(message));
      }),
    ]);
    for (const open of [false, true]) {
      const fiber = yield* serve({ host: "127.0.0.1", port: 4500, cwd: "/tmp", open }).pipe(
        Effect.provide(logs),
        Effect.forkScoped,
      );
      yield* Effect.promise(() =>
        vi.waitFor(() => expect(messages).toContain(`Workspace: ${path.resolve("/tmp")}`)),
      );
      expect(openBrowser).toHaveBeenCalledTimes(Number(open));
      yield* Fiber.interrupt(fiber);
      expect(BunHttpServer.layer).toHaveBeenCalledWith({ hostname: "127.0.0.1", port: 4500 });
      expect(routes).toHaveBeenCalledWith(
        yield* path.fromFileUrl(new URL("../../web/dist/client/", import.meta.url)),
      );
      messages.length = 0;
    }
    expect(openBrowser).toHaveBeenCalledWith("http://127.0.0.1:4500");
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
