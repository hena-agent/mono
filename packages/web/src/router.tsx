import { QueryClient } from "@tanstack/react-query";
import { createRouter, type Router } from "@tanstack/react-router";
import { Effect } from "effect";

import { Client, createClient, rpcUrl } from "./rpc-client.ts";
import { createStatusCollection } from "./status.ts";
import { routeTree } from "./routeTree.gen.ts";

export function getRouter(): Router<typeof routeTree> {
  const queryClient = new QueryClient();
  const runtime = createClient(Effect.sync(() => rpcUrl(window.location.href)));
  const collection = createStatusCollection(
    queryClient,
    Effect.tryPromise((signal) =>
      runtime.runPromise(
        Client.use((client) => client["server.status"]()),
        { signal },
      ),
    ),
  );
  return createRouter({
    routeTree,
    context: { queryClient, collection, runtime },
    defaultPreload: "intent",
    defaultPreloadDelay: 0,
    scrollRestoration: true,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
