import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import { HenaRpc } from "@hena-dev/rpc";

import { StatusHandlers } from "./status.ts";

it.effect("serves the ready status through the real RPC handler", () =>
  Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(HenaRpc);
    expect(yield* client["server.status"]()).toEqual({ id: "server", status: "ready" });
  }).pipe(Effect.provide(StatusHandlers), Effect.scoped),
);
