import { expect, it } from "@effect/vitest";
import { QueryClient } from "@tanstack/react-query";
import { Effect, Layer, ManagedRuntime, Schema } from "effect";
import { RpcClientError, RpcClientDefect } from "effect/unstable/rpc/RpcClientError";
import { Socket } from "effect/unstable/socket";
import { vi } from "vitest";

import { Client } from "./rpc-client.ts";
import { Connection, createStatusCollection } from "./status.ts";

const ready = { id: "server", status: "ready" } as const;

it("maps socket failures to unavailable and recovers using one managed runtime", async () => {
  let read: Effect.Effect<typeof ready, RpcClientError> = Effect.succeed(ready);
  const runtime = ManagedRuntime.make(
    Layer.succeed(Client, { "server.status": () => Effect.suspend(() => read) } as Client),
  );
  const queryClient = new QueryClient();
  const collection = createStatusCollection(queryClient, runtime);
  try {
    expect(collection.id).toBe("server-status");
    expect(collection.status).toBe("idle");
    await collection.preload();
    expect(queryClient.getQueryData(["server.status"])).toEqual([ready]);
    for (const reason of [
      new Socket.SocketOpenError({ kind: "Unknown", cause: "offline" }),
      new Socket.SocketReadError({ cause: "offline" }),
      new Socket.SocketWriteError({ cause: "offline" }),
      new Socket.SocketCloseError({ code: 1006, closeReason: "offline" }),
    ]) {
      read = Effect.fail(new RpcClientError({ reason }));
      await collection.utils.refetch();
      expect(collection.get("server")).toMatchObject({ id: "server", status: "unavailable" });
    }
    read = Effect.succeed(ready);
    await collection.utils.refetch();
    expect(collection.get("server")).toMatchObject(ready);
  } finally {
    await collection.cleanup();
    queryClient.clear();
    await runtime.dispose();
  }
});

it.each(["defect", "protocol"])("keeps a %s failure in Query's error channel", async (kind) => {
  const error = new Error("broken contract");
  const read =
    kind === "defect"
      ? Effect.die(error)
      : Effect.fail(
          new RpcClientError({
            reason: new RpcClientDefect({ message: "broken contract", cause: error }),
          }),
        );
  const runtime = ManagedRuntime.make(
    Layer.succeed(Client, { "server.status": () => read } as Client),
  );
  const queryClient = new QueryClient();
  const collection = createStatusCollection(queryClient, runtime);
  const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
  try {
    await expect(collection.preload()).rejects.toThrow("broken contract");
    expect(queryClient.getQueryState(["server.status"])?.status).toBe("error");
    expect(collection.get("server")).toBeUndefined();
    expect(log).toHaveBeenCalled();
  } finally {
    await collection.cleanup();
    queryClient.clear();
    await runtime.dispose();
    log.mockRestore();
  }
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

it("cancelling a Query interrupts the RPC effect in its managed runtime", async () => {
  let started = false;
  let interrupted = false;
  const read = Effect.gen(function* () {
    started = true;
    return yield* Effect.never;
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        interrupted = true;
      }),
    ),
  );
  const runtime = ManagedRuntime.make(
    Layer.succeed(Client, { "server.status": () => read } as Client),
  );
  const queryClient = new QueryClient();
  const collection = createStatusCollection(queryClient, runtime);
  try {
    void collection.preload();
    await vi.waitFor(() => expect(started).toBe(true));
    await queryClient.cancelQueries({ queryKey: ["server.status"] });
    await vi.waitFor(() => expect(interrupted).toBe(true));
  } finally {
    await collection.cleanup();
    queryClient.clear();
    await runtime.dispose();
  }
});
