import { QueryClientProvider } from "@tanstack/react-query";
import { createRootRouteWithContext } from "@tanstack/react-router";
import type { ReactElement } from "react";

import { Document } from "../document.tsx";
import { NotFound } from "../pages.tsx";
import { Shell } from "../shell.tsx";
import type { WebContext } from "../web-context.ts";
import appCss from "../styles.css?url";

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
  const { queryClient, collection } = Route.useRouteContext();
  return (
    <QueryClientProvider client={queryClient}>
      <Shell collection={collection} />
    </QueryClientProvider>
  );
}
