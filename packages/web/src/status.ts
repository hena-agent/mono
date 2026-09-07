import { createCollection, type Collection, type NonSingleResult } from "@tanstack/db";
import { queryCollectionOptions, type QueryCollectionUtils } from "@tanstack/query-db-collection";
import type { QueryClient } from "@tanstack/react-query";
import { Effect, Schema, type ManagedRuntime } from "effect";

import { Client } from "./rpc-client.ts";

export const Connection: Schema.Struct<{
  readonly id: Schema.Literal<"server">;
  readonly status: Schema.Literals<readonly ["ready", "unavailable"]>;
}> = Schema.Struct({
  id: Schema.Literal("server"),
  status: Schema.Literals(["ready", "unavailable"]),
});
export type Connection = typeof Connection.Type;
export type StatusCollection = Collection<
  Connection,
  "server",
  QueryCollectionUtils<Connection, "server">
> &
  NonSingleResult;

const unavailable = (): Effect.Effect<Connection[]> =>
  Effect.succeed([{ id: "server", status: "unavailable" }]);

export const createStatusCollection = (
  queryClient: QueryClient,
  runtime: ManagedRuntime.ManagedRuntime<Client, never>,
): StatusCollection =>
  createCollection(
    queryCollectionOptions({
      id: "server-status",
      queryKey: ["server.status"],
      queryClient,
      schema: Schema.toStandardSchemaV1(Connection),
      getKey: (row) => row.id,
      startSync: false,
      retry: false,
      queryFn: ({ signal }) =>
        runtime.runPromise(
          Client.use((client) => client["server.status"]()).pipe(
            Effect.map((status): Connection[] => [status]),
            Effect.catchReasons("RpcClientError", {
              SocketOpenError: unavailable,
              SocketReadError: unavailable,
              SocketWriteError: unavailable,
              SocketCloseError: unavailable,
            }),
          ),
          { signal },
        ),
    }),
  );
