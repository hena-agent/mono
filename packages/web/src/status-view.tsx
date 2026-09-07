import { Button } from "@base-ui/react/button";
import type { ReactElement } from "react";

import type { Connection } from "./status.ts";

const labels = { ready: "Server ready", unavailable: "Server unavailable" } as const;

export function StatusView({
  status,
  retry,
}: {
  readonly status: Connection["status"] | undefined;
  readonly retry: () => void;
}): ReactElement {
  return (
    <section className="connection" aria-label="Connection">
      <p role="status" className="connection-label" data-state={status}>
        <span className="connection-dot" aria-hidden="true" />
        {status === undefined ? "Local connection" : labels[status]}
      </p>
      {status === "unavailable" && (
        <p>Start the server with bun run hena serve, then check again.</p>
      )}
      <Button className="connection-button" onClick={retry}>
        Check connection
      </Button>
    </section>
  );
}
