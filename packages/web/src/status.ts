import type { ServerStatus } from "@hena-dev/rpc";
import { createCollection, type Collection } from "@tanstack/db";
import { queryCollectionOptions, type QueryCollectionUtils } from "@tanstack/query-db-collection";
import type { QueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";

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
>;

export const createStatusCollection = <E>(
  queryClient: QueryClient,
  read: Effect.Effect<ServerStatus, E>,
): StatusCollection =>
  createCollection(
    queryCollectionOptions({
      id: "server-status",
      queryKey: ["server.status"],
      queryClient,
      schema: Schema.toStandardSchemaV1(Connection),
      getKey: (row) => row.id,
      startSync: false,
      queryFn: ({ signal }) =>
        Effect.runPromise(
          read.pipe(
            Effect.match({
              onSuccess: (status): Connection[] => [status],
              onFailure: (): Connection[] => [{ id: "server", status: "unavailable" }],
            }),
          ),
          { signal },
        ),
    }),
  );
