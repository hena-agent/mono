import { expect, it, vi } from "vitest";
import { Layer, ManagedRuntime } from "effect";

import { Client } from "./rpc-client.ts";
import { createWebContext } from "./web-context.ts";

it("owns teardown, cancels work, and registers one idempotent HMR disposer", async () => {
  const runtime = ManagedRuntime.make(Layer.succeed(Client, {} as Client));
  const hot = { dispose: vi.fn<(callback: () => Promise<void>) => void>() };
  const context = createWebContext(runtime, hot);
  const order: string[] = [];
  vi.spyOn(context.queryClient, "cancelQueries").mockImplementation(async () => {
    order.push("cancel");
  });
  vi.spyOn(context.collection, "cleanup").mockImplementation(async () => {
    order.push("collection");
  });
  vi.spyOn(context.queryClient, "clear").mockImplementation(() => {
    order.push("cache");
  });
  const close = vi.spyOn(runtime, "dispose").mockImplementation(async () => {
    order.push("runtime");
  });
  expect(hot.dispose).toHaveBeenCalledExactlyOnceWith(context.dispose);
  const first = hot.dispose.mock.calls[0]![0]();
  expect(context.dispose()).toBe(first);
  await first;
  expect(order).toEqual(["cancel", "collection", "cache", "runtime"]);
  expect(close).toHaveBeenCalledOnce();
});

it("still closes the runtime when collection cleanup fails", async () => {
  const runtime = ManagedRuntime.make(Layer.succeed(Client, {} as Client));
  const context = createWebContext(runtime);
  const error = new Error("cleanup failed");
  const collectionCleanup = vi.spyOn(context.collection, "cleanup");
  collectionCleanup.mockRejectedValue(error);
  const close = vi.spyOn(runtime, "dispose");
  const clear = vi.spyOn(context.queryClient, "clear");
  await expect(context.dispose()).rejects.toBe(error);
  expect(close).toHaveBeenCalledOnce();
  expect(clear).toHaveBeenCalledOnce();
  expect(collectionCleanup).toHaveBeenCalledOnce();
});

it("does not start network requests while rendering the server shell", async () => {
  const runtime = ManagedRuntime.make(Layer.succeed(Client, {} as Client));
  const run = vi.spyOn(runtime, "runPromise");
  const context = createWebContext(runtime);
  context.collection.startSyncImmediate();
  expect(run).not.toHaveBeenCalled();
  await context.dispose();
});
