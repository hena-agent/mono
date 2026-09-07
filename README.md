# hena

A local, extensible agent project. Built with Bun, Effect v4, and TanStack.

## Run

```sh
bun install --frozen-lockfile
bun dev
```

Open `http://127.0.0.1:3000`. Vite proxies `/rpc` to the Effect server on
`127.0.0.1:4400`. No API key or configuration is needed for the status page.

To use the production browser path:

```sh
bun run build
bun run hena serve --open
```

The CLI serves the built SPA at `http://127.0.0.1:4400`. It supports `--host`,
`--port`, `--cwd`, and `--open`. `bun run hena --help` lists the commands.
`Ctrl-C` closes the scoped server. `bun start` is shorthand for `hena serve`.
Use a different `--port` if the port is occupied.

## Verify

```sh
bun run check
bun run mutation
bun run --cwd packages/web playwright install chromium
bun run e2e
```

Playwright starts the actual CLI with the built SPA on port 4401 and checks both
desktop and mobile. It verifies WebSocket status, navigation, deep-link reload,
and browser errors. It also disconnects/reconnects the RPC WebSocket without a
page reload. The same scenarios run in CI. For the dev-server path:

```sh
HENA_E2E_DEV=1 bun run --cwd packages/web e2e
```

Manual smoke: visit the page, confirm **Server ready**, navigate to **System**,
reload, stop the server, use **Check connection**, and confirm the recovery hint.

## Layout

- `packages/rpc`: Effect Schema and RPC contracts, safe to import in the browser.
- `packages/server`: RPC handlers and static routes; the host supplies platform Layers.
- `packages/cli`: `hena serve`, Effect CLI parsing and Bun platform composition.
- `packages/web`: TanStack Start SPA, Router, Query, DB, and shadcn `buG05C4` styling.
- `packages/core`, `packages/ci-gates`: existing shared utilities and quality gates.

Handwritten code retains the 100% coverage and mutation thresholds. The web
package uses Vite rather than declaration-only builds, permits only the shadcn
`@/* -> ./src/*` alias, and typechecks its generated route tree. That exact
generated file is excluded from handwritten-code gates. The web app does not
emit library declarations, so `isolatedDeclarations` is disabled only there;
strict type checking remains enabled. The shared Vitest config is also used by
web mutation tests, without Start's build-time route transforms.

The router-context factory owns the Query client, collection, and managed Effect
runtime. Its idempotent `dispose()` cancels requests and tears down resources in
order; Vite invokes it on module replacement. React subscribes directly to the
status collection without creating a derived query, and route remounts do not
dispose shared services. Queries stay disabled during server rendering.
Status requests cross from Effect into Query once: socket
failures produce an unavailable status, while defects and protocol errors remain
Query errors with diagnostics.

## Delivery

PR0 is the tested CLI/server/browser foundation. Chat, the agent loop, durable
events, models, tools, and extension loading are subsequent test-first slices;
the status page does not claim those capabilities are installed.
