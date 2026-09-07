import { NodeHttpPlatform, NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { routes } from "./routes.ts";

it.effect("serves only the SPA build, including deep links and correct asset MIME types", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    yield* fs.writeFileString(`${root}/index.html`, "<h1>hena</h1>");
    yield* fs.writeFileString(`${root}/app.js`, "console.log('hena')");
    const app = HttpRouter.toWebHandler(
      routes(root).pipe(Layer.provide([NodeServices.layer, NodeHttpPlatform.layer])),
    );
    yield* Effect.addFinalizer(() => Effect.promise(() => app.dispose()));
    for (const path of ["/", "/system"]) {
      const response = yield* Effect.promise(() =>
        app.handler(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } })),
      );
      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.text())).toBe("<h1>hena</h1>");
      expect(response.headers.get("cache-control")).toBe("no-cache");
    }
    const asset = yield* Effect.promise(() => app.handler(new Request("http://localhost/app.js")));
    expect(asset.headers.get("content-type")).toContain("javascript");
    const missing = yield* Effect.promise(() =>
      app.handler(new Request("http://localhost/missing.js")),
    );
    expect(missing.status).toBe(404);
  }).pipe(Effect.provide(NodeServices.layer), Effect.scoped),
);
