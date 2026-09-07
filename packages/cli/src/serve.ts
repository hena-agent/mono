import { BunHttpServer } from "@effect/platform-bun";
import { routes } from "@hena-dev/server";
import { Effect, Layer, Path, type PlatformError, type Scope } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import type { ServeOptions } from "./command.ts";

export const serve: (
  options: ServeOptions,
) => Effect.Effect<
  never,
  PlatformError.PlatformError,
  Path.Path | ChildProcessSpawner.ChildProcessSpawner
> = Effect.fnUntraced(function* (
  options: ServeOptions,
): Effect.fn.Return<
  never,
  PlatformError.PlatformError,
  Path.Path | ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> {
  const path = yield* Path.Path;
  const webRoot = yield* path
    .fromFileUrl(new URL("../../web/dist/client/", import.meta.url))
    .pipe(Effect.orDie);
  const server = HttpRouter.serve(routes(webRoot)).pipe(
    Layer.provide(BunHttpServer.layer({ hostname: options.host, port: options.port })),
  );
  yield* Layer.build(server);
  yield* Effect.logInfo(`Workspace: ${path.resolve(options.cwd)}`);
  if (options.open) {
    const url = `http://${options.host}:${options.port}`;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const command = process.platform === "darwin" ? "open" : "xdg-open";
    yield* spawner
      .exitCode(ChildProcess.make(command, [url]))
      .pipe(Effect.catch(() => Effect.logWarning(`Open ${url} in your browser.`)));
  }
  return yield* Effect.never;
}, Effect.scoped);
