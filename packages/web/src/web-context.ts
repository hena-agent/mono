import { QueryClient } from "@tanstack/react-query";
import type { ManagedRuntime } from "effect";

import type { Client } from "./rpc-client.ts";
import { createStatusCollection, type StatusCollection } from "./status.ts";

export interface WebContext {
  readonly queryClient: QueryClient;
  readonly collection: StatusCollection;
  readonly dispose: () => Promise<void>;
}

export function createWebContext(
  runtime: ManagedRuntime.ManagedRuntime<Client, never>,
  hot?: Pick<NonNullable<ImportMeta["hot"]>, "dispose">,
): WebContext {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: typeof window !== "undefined" } },
  });
  const collection = createStatusCollection(queryClient, runtime);
  let disposal: Promise<void> | undefined;
  const dispose = (): Promise<void> =>
    (disposal ??= (async () => {
      try {
        await queryClient.cancelQueries();
        await collection.cleanup();
      } finally {
        queryClient.clear();
        await runtime.dispose();
      }
    })());
  hot?.dispose(dispose);
  return { queryClient, collection, dispose };
}
