import { Schema } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

export const ServerStatus: Schema.Struct<{
  readonly id: Schema.Literal<"server">;
  readonly status: Schema.Literal<"ready">;
}> = Schema.Struct({
  id: Schema.Literal("server"),
  status: Schema.Literal("ready"),
});
export type ServerStatus = typeof ServerStatus.Type;

export const StatusRpc: Rpc.Rpc<"server.status", Schema.Void, typeof ServerStatus> = Rpc.make(
  "server.status",
  {
    success: ServerStatus,
  },
);

export const HenaRpc: RpcGroup.RpcGroup<typeof StatusRpc> = RpcGroup.make(StatusRpc);
