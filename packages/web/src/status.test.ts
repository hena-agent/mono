import { expect, it } from "@effect/vitest";
import { QueryClient } from "@tanstack/react-query";
import { Effect, Schema } from "effect";
import { vi } from "vitest";

import { Connection, createStatusCollection } from "./status.ts";

it("feeds schema-validated RPC status through Query into DB and recovers from failure", async () => {
  const queryClient = new QueryClient();
  let online = true;
  const collection = createStatusCollection(
    queryClient,
    Effect.suspend(() =>
      online
        ? Effect.succeed({ id: "server" as const, status: "ready" as const })
        : Effect.fail("offline"),
    ),
  );
  expect(collection.id).toBe("server-status");
  expect(collection.status).toBe("idle");
  await collection.preload();
  expect(queryClient.getQueryData(["server.status"])).toEqual([{ id: "server", status: "ready" }]);
  expect(collection.get("server")).toMatchObject({ id: "server", status: "ready" });
  online = false;
  await collection.utils.refetch();
  expect(collection.get("server")).toMatchObject({ id: "server", status: "unavailable" });
  online = true;
  await collection.utils.refetch();
  expect(collection.get("server")).toMatchObject({ id: "server", status: "ready" });
  await collection.cleanup();
  queryClient.clear();
});

it("validates connection rows with Effect Schema", () => {
  for (const status of ["ready", "unavailable"] as const) {
    expect(Schema.decodeSync(Connection)({ id: "server", status })).toEqual({
      id: "server",
      status,
    });
  }
  expect(() => Schema.decodeUnknownSync(Connection)({ id: "other", status: "ready" })).toThrow();
  expect(() =>
    Schema.decodeUnknownSync(Connection)({ id: "server", status: "unexpected" }),
  ).toThrow();
});

it("cancelling a Query interrupts its Effect", async () => {
  const queryClient = new QueryClient();
  let started = false;
  let interrupted = false;
  const collection = createStatusCollection(
    queryClient,
    Effect.gen(function* () {
      started = true;
      return yield* Effect.never;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          interrupted = true;
        }),
      ),
    ),
  );
  void collection.preload();
  await vi.waitFor(() => expect(started).toBe(true));
  await queryClient.cancelQueries({ queryKey: ["server.status"] });
  await vi.waitFor(() => expect(interrupted).toBe(true));
  await collection.cleanup();
  queryClient.clear();
});
