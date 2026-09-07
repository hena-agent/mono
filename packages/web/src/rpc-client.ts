import { HenaRpc, type StatusRpc } from "@hena-dev/rpc";
import { Context, Effect, Layer, ManagedRuntime } from "effect";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";
import type { RpcClientError } from "effect/unstable/rpc/RpcClientError";
import { Socket } from "effect/unstable/socket";

export type Client = RpcClient.RpcClient<typeof StatusRpc, RpcClientError>;
export const Client: Context.Service<Client, Client> =
  Context.Service<Client>("@hena-dev/web/Client");

export const createClient = (
  url: Effect.Effect<string>,
): ManagedRuntime.ManagedRuntime<Client, never> =>
  ManagedRuntime.make(
    Layer.effect(Client, RpcClient.make(HenaRpc)).pipe(
      Layer.provide(RpcClient.layerProtocolSocket()),
      Layer.provide([Socket.layerWebSocket(url), RpcSerialization.layerNdjson]),
      Layer.provide(Socket.layerWebSocketConstructorGlobal),
    ),
  );

export const rpcUrl = (href: string): string => {
  const url = new URL("/rpc", href);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.href;
};
