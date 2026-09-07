import { HenaRpc, ServerStatus, type StatusRpc } from "@hena-dev/rpc";
import { Effect, type Layer } from "effect";
import type { Rpc } from "effect/unstable/rpc";

export const StatusHandlers: Layer.Layer<Rpc.ToHandler<typeof StatusRpc>> = HenaRpc.toLayer({
  "server.status": () => Effect.succeed(ServerStatus.make({ id: "server", status: "ready" })),
});
