import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";
import { useEffect, useMemo, type ReactElement } from "react";

import { Document } from "../document.tsx";
import { NotFound } from "../pages.tsx";
import { Shell } from "../shell.tsx";
import type { StatusCollection } from "../status.ts";
import type { createClient } from "../rpc-client.ts";
import appCss from "../styles.css?url";

export interface WebContext {
  readonly queryClient: QueryClient;
  readonly collection: StatusCollection;
  readonly runtime: ReturnType<typeof createClient>;
}

export const Route = createRootRouteWithContext<WebContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "hena / A small beginning" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: Root,
  shellComponent: Document,
  notFoundComponent: NotFound,
});

function Root(): ReactElement {
  const { queryClient, collection, runtime } = Route.useRouteContext();
  const resources = useMemo(
    () => ({ queryClient, collection, runtime, users: 0 }),
    [queryClient, collection, runtime],
  );
  useEffect(() => {
    resources.users += 1;
    return () => {
      resources.users -= 1;
      // StrictMode remounts effects synchronously; defer disposal until the last consumer is gone.
      queueMicrotask(() => {
        if (resources.users === 0) {
          void resources.collection.cleanup();
          resources.queryClient.clear();
          void resources.runtime.dispose();
        }
      });
    };
  }, [resources]);
  return (
    <QueryClientProvider client={queryClient}>
      <Shell collection={collection} />
    </QueryClientProvider>
  );
}
