import { RiArrowRightUpLine } from "@remixicon/react";
import { useLiveQuery } from "@tanstack/react-db";
import { Link, Outlet } from "@tanstack/react-router";
import type { ReactElement } from "react";

import type { StatusCollection } from "./status.ts";
import { StatusView } from "./status-view.tsx";

export function Shell({ collection }: { readonly collection: StatusCollection }): ReactElement {
  const { data } = useLiveQuery({ query: (q) => q.from({ connection: collection }) });
  return (
    <div className="app-shell">
      <header className="app-header">
        <Link className="wordmark" to="/" aria-label="hena home">
          hena<span aria-hidden="true">.</span>
        </Link>
        <nav aria-label="Main navigation">
          <Link to="/">Overview</Link>
          <Link to="/system">System</Link>
        </nav>
        <span className="edition">LOCAL / PR0</span>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="app-footer">
        <StatusView
          status={data[0]?.status}
          retry={() => {
            void collection.utils.refetch();
          }}
        />
        <a href="https://github.com/tanstack/ai" target="_blank" rel="noreferrer">
          Built to be extended
          <RiArrowRightUpLine size={16} aria-hidden="true" />
        </a>
      </footer>
    </div>
  );
}
