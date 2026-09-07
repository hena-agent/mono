import { NodeHttpServer } from "@effect/platform-node";
import { routes } from "@hena-dev/server";
import { expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/unstable/http";

import { Client, createClient, rpcUrl } from "./rpc-client.ts";

it("uses the same origin and the correct websocket protocol", () => {
  expect(rpcUrl("https://hena.example/system?x=1")).toBe("wss://hena.example/rpc");
  expect(rpcUrl("http://localhost:4400/system")).toBe("ws://localhost:4400/rpc");
});

it.live("opens a schema-validated NDJSON websocket and disposes the client", () =>
  Effect.gen(function* () {
    yield* Layer.build(HttpRouter.serve(routes("/unused")));
    const server = yield* HttpServer.HttpServer;
    const address = server.address as HttpServer.TcpAddress;
    const runtime = createClient(Effect.succeed(`ws://127.0.0.1:${address.port}/rpc`));
    yield* Effect.addFinalizer(() => Effect.promise(() => runtime.dispose()));
    const response = yield* Effect.promise(() =>
      runtime.runPromise(Client.use((client) => client["server.status"]())),
    );
    expect(response).toEqual({ id: "server", status: "ready" });
    expect(Client.key).toBe("@hena-dev/web/Client");
    yield* Effect.promise(() => runtime.dispose());
  }).pipe(Effect.provide(NodeHttpServer.layerTest), Effect.scoped),
);
