import { createRouter, type Router } from "@tanstack/react-router";
import { Effect } from "effect";

import { createClient, rpcUrl } from "./rpc-client.ts";
import { createWebContext } from "./web-context.ts";
import { routeTree } from "./routeTree.gen.ts";

export function getRouter(): Router<typeof routeTree> {
  const runtime = createClient(Effect.sync(() => rpcUrl(window.location.href)));
  const context = createWebContext(runtime, import.meta.hot);
  return createRouter({
    routeTree,
    context,
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
