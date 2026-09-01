# hena — Extensible AI Agent

- **Status**: Draft v1 (grilling session complete, pending final review) — amended 2026-08-31: `unknown` → `Json` in §4.1/§5.1, D25 added, per [`monorepo-quality-gates.md`](./monorepo-quality-gates.md)
- **Date**: 2026-08-31
- **Repo**: `hena-agent/mono` (greenfield)
- **npm scope**: `@hena-dev/*` — **binary**: `hena`

## 1. Philosophy

1. **Tiny core.** The core consists of very small primitives and nothing else.
2. **Everything is an extension.** Tools, persistence, models, providers, skills, subagents, compaction, servers — all extensions.
3. **Every internal is overridable, replaceable, or extendable.** No privileged code paths.
4. **SQLite** is the database; domain model schemas use **Effect v4 Schema**.
5. **Small, testable modules.** Every package is split into tiny single-purpose modules (TanStack AI style).
6. **Effect v4 everywhere.** Used as extensively as possible across the entire repository.
7. **Maximize LLM cache hit rate.** Everything that affects the provider cache key (system prompt, tools, skills, model, reasoning effort, provider options) is frozen at a session's first message and can never change within that session. Target: 100% prefix-cache hits from message 2 onward.

Tension between (2)/(3) and (7) is resolved by a single rule: **implementations may change at any time; interfaces may only change at session boundaries** (see §5).

## 2. What we are building

A **framework-first** library for building extensible AI agents, plus **one reference app** built exclusively from public extension APIs (the honesty check): a CLI whose `hena serve` command starts a local web server with a **Web UI** (no TUI). The flagship capability: the agent can **improve its own extensions (code) and skills (prose) at runtime**, with changes hot-reloaded into the live process.

Primary consumer on day one: us. API design standard: third-party developers.

## 3. Decision log

| # | Decision | Choice |
|---|---|---|
| D1 | Project shape | Framework-first + reference app built only on public extension APIs |
| D2 | Execution model | Event-sourced runs: state = fold over an append-only event log |
| D3 | Model layer | Core defines its own `LanguageModel` port; TanStack AI wrapper is the first provider extension; `effect/unstable/ai` bridge later |
| D4 | Core primitives | Event, State (fold), Loop, Port, Hook, Extension, Tool (interface only), `Stream<Event>`, PromptSpec, Session (minimal) |
| D5 | Extension mechanism | Effect Layers for provision + typed hook pipeline for stacking; extensions are Effects; **hot-reloadable** |
| D6 | Runtime | Core and most extensions runtime-agnostic; Bun-only bits isolated (SQLite, server, CLI) |
| D7 | Effect v4 policy | Treat `4.0.0-rc.112` as stable; use everything incl. `unstable/*`; pin exact version workspace-wide; upgrade deliberately and quickly |
| D8 | Naming | Scope `@hena-dev/*`; binary `hena`; project dir `.hena/`; global dir `~/.hena/` |
| D9 | v1 scope | Core, hot reload, SQLite persistence, TanStack provider (Anthropic + OpenAI-compatible), fs/shell tools, skills, compaction (as successor sessions), permissions, server, Web UI, CLI. Subagents v1.5. MCP excluded from v1 |
| D10 | Testing | Vitest + `@effect/vitest` (rc line), Turborepo-cached per package |
| D11 | Extension sources | Packaged (static, workspace packages) + live watched directories (project + global) |
| D12 | Hot reload | In-process layer swap at step boundaries; restart is a manual escape hatch; strategy itself behind an `ExtensionRuntime` port |
| D13 | Broken extensions | Activation = successful import + optional `healthCheck` Effect; last-good rollback; lifecycle recorded as events the agent can observe |
| D14 | Agent mutates extensions | Implicitly, via normal file tools + watcher. No dedicated extension-management tool. Project/global distinction respected |
| D15 | First providers | Anthropic + OpenAI-compatible (covers OpenAI, OpenRouter, Ollama, local) via TanStack AI adapters |
| D16 | v1 tools | `fs` (read/write/edit/glob/grep), `shell` (no sandbox; `ShellExecutor` port for future isolation), permission/approval hooks in v1 |
| D17 | Skills | SKILL.md convention (agentskills-compatible), project + global dirs, watched, agent-writable |
| D18 | Reference app | `hena serve` → web server + Web UI. No TUI |
| D19 | Configuration | Typed TS config (`hena.config.ts`, optional) for static composition + convention-based discovery of `.hena/{extensions,skills}` and `~/.hena/{extensions,skills}` |
| D20 | Cache freeze | Frozen PromptSpec per session; **no rebase — ever**. New capabilities require a new session. 100% cache-hit goal |
| D21 | Web UI | React + Vite + `@tanstack/ai-client` / `@tanstack/ai-react`; chat + event inspector + approvals + session list; deliberately crude |
| D22 | Server protocol | Chat endpoint speaks TanStack AI stream protocol; everything else REST + SSE via `effect/unstable/httpapi` |
| D23 | Database | **One global DB**, opencode-style: `<xdg-data>/hena/hena.db` (`~/.local/share/hena/hena.db`), WAL, env override `HENA_DB`. Projects are rows, keyed by absolute worktree path |
| D24 | Repo tooling | Bun workspaces + Turborepo; **oxlint** (lint) + **oxfmt** (format); no Biome; no changesets (fixed version, manual bumps); private until API stabilizes |
| D25 | Quality gates & CI | Defined in [`monorepo-quality-gates.md`](./monorepo-quality-gates.md): 100% coverage, 0 surviving mutants, complexity/Halstead/LOC caps, 0 dead/duplicated code, **0 `any`/`unknown` tokens** — domain types use core's `Json` instead |

## 4. Core primitives (`@hena-dev/core`)

The core depends on `effect` only. It contains **zero** tools, providers, persistence, or transport.

### 4.1 Event

The atom of the system. Everything that happens is an event.

```ts
// Envelope (Effect Schema)
interface EventEnvelope {
  readonly id: EventId          // UUIDv7 (time-ordered)
  readonly sessionId: SessionId
  readonly seq: number          // per-session, dense, assigned by EventStore
  readonly type: string         // e.g. "message.user", "tool.result"
  readonly version: number      // schema version of the payload
  readonly payload: Json        // JSON value (core's recursive Json type); validated by the registered Schema for (type, version)
  readonly createdAt: DateTime
}
```

- **Open union**: core ships baseline event types; any extension registers additional types into an `EventRegistry` (a `Schema` per `(type, version)`).
- **Versioning**: upcasters `(type, v) -> (type, v+1)` registered alongside schemas; applied on read.
- **Unknown events are preserved opaquely** (an absent extension must never corrupt or drop history).
- **Durable vs ephemeral**: token-level stream deltas are ephemeral (bus only, never stored). Consolidated events (full assistant message, tool result) are durable (stored). Each event type declares its durability.

Baseline durable events: `session.created` (carries the frozen PromptSpec), `turn.started`, `message.user`, `message.assistant`, `tool.call` , `tool.approval.requested`, `tool.approval.resolved`, `tool.result`, `turn.completed`, `error`, `extension.loaded`, `extension.reloaded`, `extension.failed`, `extension.rolledBack`, `skill.loaded`, `session.compacted`.

Baseline ephemeral events: `model.delta` (text/reasoning/tool-call streaming chunks), `model.usage` (incl. cache-read/write token counts — surfaced in the inspector to *prove* the cache philosophy is working).

### 4.2 State

There is no mutable state object. Any state is a **fold** over the event log:

```ts
interface Reducer<S> {
  readonly initial: S
  readonly reduce: (state: S, event: EventEnvelope) => S  // pure
}
```

Core ships one reducer: `ConversationReducer` (event log → provider-ready message list). Extensions register their own reducers to derive their own state slices. Resume-after-restart = refold. No snapshots in v1 (chat-scale logs are cheap to fold); a `SnapshotStore` port can be added later without core changes.

### 4.3 Session, Turn, Step

- **Session**: an event log scope + a **frozen PromptSpec**. The unit of cache identity. Core knows only `{ id, promptSpec }`; titles, listing, timestamps are persistence/server concerns.
- **Turn**: `message.user` → loop runs → `turn.completed`. One turn active per session (guarded by a semaphore); many sessions concurrently per process.
- **Step**: one model call + the tool executions it requests. **Step boundaries are the only points where hot-swapped code takes effect.**

### 4.4 Loop

The loop is deliberately dumb:

```
turn(userMsg):
  emit message.user
  loop:
    ctx      = fold(events)                     // ConversationReducer
    guard    = verify PromptSpec hash unchanged  // cache guard, §5.4
    response = LanguageModel.stream(promptSpec, ctx)   // via wrapModelCall hooks
    emit message.assistant (+ deltas on bus)
    if no tool calls: break
    for each tool call:
      approval via approveToolCall hooks → emit approval events
      result = tool.handler(input)               // via wrapToolCall hooks
      emit tool.result
    // ← step boundary: pending extension swaps apply here
  emit turn.completed
```

All failures are converted to `error` events (typed via Schema) — the agent and the UI observe failures the same way they observe everything else.

### 4.5 Port

A port is a `Context.Tag`-keyed service interface with no implementation in core:

| Port | Responsibility | Implemented by |
|---|---|---|
| `LanguageModel` | `stream(promptSpec, messages) -> Stream<ModelChunk>` | `provider-tanstack` |
| `EventStore` | append (assigns `seq`), read, list sessions | `persistence-sqlite` |
| `EventBus` | `publish` / `subscribe: Stream<EventEnvelope>` (built on `PubSub`) | core provides in-memory default |
| `IdGenerator` | UUIDv7 ids | core default |
| `ExtensionRuntime` | load/reload/rollback dynamic extensions | `extension-runtime` |
| `ShellExecutor` | run a shell command | `tools-shell` (local process; sandbox later) |

Overriding = providing a different Layer. That is the entire replacement mechanism.

### 4.6 Hook

Ports allow *replacement*; hooks allow *stacking*. A hook is a core-defined service into which many extensions register; registrations are ordered by `(priority, extensionName)` — deterministic, which matters for §5.

| Hook | Signature (sketch) | When |
|---|---|---|
| `buildPromptSpec` | contribute system-prompt segments, tools, skill descriptors, model params | **session creation only** — the single composition point for anything cache-affecting |
| `wrapModelCall` | middleware around `LanguageModel.stream` | every step |
| `wrapToolCall` | middleware around a tool handler | every tool execution |
| `approveToolCall` | `(call) -> allow \| deny \| ask(user)` | before tool execution |
| `onEvent` | tap on the event stream (read-only) | every event |

Compaction, telemetry, guardrails, permissions, retries — all are combinations of these five. If a sixth hook is ever needed, that is a core change and requires a spec amendment.

### 4.7 Tool (interface only)

```ts
interface Tool<I, O> {
  readonly name: string
  readonly description: string
  readonly input: Schema<I>
  readonly output: Schema<O>
  readonly handler: (input: I) => Effect<O, ToolError>
  // derived: interfaceHash = sha256(canonical({name, description, inputJsonSchema}))
}
```

`interfaceHash` is what decides hot-swap vs. defer-to-next-session (§6.4).

### 4.8 Extension

```ts
// defineExtension — the only public authoring API
export default defineExtension({
  name: "my-extension",
  layer: (api) => Layer,          // provides ports and/or registers into hooks,
                                  // registers tools / event schemas / reducers
  healthCheck?: Effect<void, HealthCheckError>,  // gate for activation on (re)load
})
```

An extension **is an Effect artifact**: its `layer` builds services; registration into hooks happens during layer construction. Static extensions (workspace packages) and dynamic extensions (watched directories) use the identical shape — the only difference is who imports them and when.

## 5. Cache discipline (the Frozen Prefix Rule)

### 5.1 PromptSpec

At session creation, `buildPromptSpec` hooks run once, producing:

```ts
interface PromptSpec {
  readonly model: string
  readonly providerOptions: Record<string, Json>     // temperature, reasoning effort, ...
  readonly systemSegments: ReadonlyArray<{ name: string; text: string }>  // ordered
  readonly tools: ReadonlyArray<{ name: string; description: string; inputJsonSchema: Json }>
  readonly skills: ReadonlyArray<{ name: string; description: string }>   // descriptors only
}
```

It is serialized to **canonical form**, hashed (sha256), stored in `session.created`, and **never changes**.

### 5.2 Canonical form

Identical specs must produce identical bytes:

- Canonical JSON: lexicographically sorted keys, UTF-8, no insignificant whitespace, normalized numbers; `undefined`/`NaN` forbidden by Schema.
- Tools sorted by `name`; skills sorted by `name`; system segments in hook order (`priority`, then extension name).
- The provider extension must build provider requests **deterministically** from PromptSpec + messages (stable field order, stable cache-breakpoint placement — e.g. Anthropic `cache_control` markers after system and after tools, plus the moving final-message marker).

### 5.3 The rule

- **Frozen forever.** No rebase operation exists. New/changed tools, skills, prompts, models, or reasoning effort are visible only to **sessions created afterward**. The user picks up new capabilities by clicking **New Session** in the sidebar (opencode-style) — a routine action, not an exceptional one. (Subagents — v1.5 — additionally let a parent delegate to a child session that gets a fresh spec mid-conversation.)
- **Implementation swaps are always allowed**: a tool handler's body changing does not alter any request byte → cache intact.
- **Dynamic context only appends.** File contents, timestamps, tool results enter as appended messages. Nothing is ever injected into the system prompt or reordered mid-history.
- **Skill bodies are appended**, not prepended: descriptors are frozen in the spec; `skill` tool loads the body as a tool-result message → cache-safe progressive disclosure.

### 5.4 Cache guard

At every turn start, the loop recomputes the PromptSpec from live registries and compares hashes. On drift (e.g. config changed under a live session): the turn **fails loudly** with an `error` event ("interface drift; open a new session") rather than silently busting the cache. `model.usage` events carry provider-reported cache-read/write token counts; the Web UI inspector displays the running cache-hit ratio so regressions are visible immediately.

### 5.5 Compaction (cache-compatible by construction)

Compaction never rewrites history inside a session — that would bust the prefix. Instead:

1. When the context budget is exceeded (or on demand), the compaction extension summarizes the session via the `LanguageModel` port.
2. It creates a **successor session** (fresh PromptSpec — conveniently also picking up any queued interface changes) whose first message is the summary.
3. `session.compacted` links predecessor → successor; the UI presents it as a continuation.

v1 ships the seam plus a naive token-threshold summarizer. Fancier strategies are drop-in extensions.

## 6. Hot reload (`@hena-dev/extension-runtime`)

### 6.1 Sources & precedence

- **Static**: workspace packages composed in `hena.config.ts`. Not hot-reloaded (persistence, providers, server — the footgun tier).
- **Dynamic**: watched directories, discovered by convention:
  - Project: `<worktree>/.hena/extensions/*/index.ts`
  - Global: `~/.hena/extensions/*/index.ts`
  - Project wins on name conflict.

The agent modifies dynamic extensions **implicitly**, with its ordinary `fs` tools — no dedicated management tool (D14). Humans editing the same files get the same behavior.

### 6.2 Reload lifecycle

```
change detected (watcher, debounced)
  → dynamic import with cache-busting specifier (?v=<hash>)
  → validate: import succeeded + optional healthCheck Effect passes
  → stage: new Layer built
  → swap: at the next step boundary of each session (atomic per session)
  → emit extension.reloaded { name, codeHash, interfaceChanged }
on any failure:
  → keep last-good version active
  → emit extension.failed { name, error }   // the agent SEES its own broken code and reacts
rollback (automatic on failure, or by writing the old file back):
  → emit extension.rolledBack
```

### 6.3 Strategy is a port

`ExtensionRuntime` (in-process swap) is the v1 implementation. Supervised-restart-and-refold (the event log makes this safe) and worker-isolated runtimes are future implementations of the same port. Manual restart is always a valid escape hatch — state refolds from SQLite.

### 6.4 Interplay with the Frozen Prefix Rule

On reload, each registered tool's `interfaceHash` is compared:

- **Unchanged** → handler hot-swapped; live sessions use the new implementation at the next step boundary.
- **Changed (or tool added/removed, skill descriptor changed, prompt segment changed)** → the change is **queued for future sessions only**. Live sessions retain the previous module instance (kept referenced in memory). Edge case — process restarted while a live session's spec names a tool whose interface no longer exists: the tool call fails gracefully as a `tool.result` error the agent can see. It is never silently substituted.

Memory growth from retained old modules is accepted (dev-machine agent, bounded by session lifetime).

## 7. Persistence (`@hena-dev/persistence-sqlite`)

- **One global DB** (opencode pattern): `<xdg-data>/hena/hena.db` (default `~/.local/share/hena/hena.db`), override via `HENA_DB` (absolute path or `:memory:`).
- Stack: `effect/unstable/sql` + `@effect/sql-sqlite-bun` (pinned rc). Pragmas on open: `journal_mode=WAL`, `synchronous=NORMAL`, `busy_timeout=5000`, `foreign_keys=ON`.
- Migrations: ordered TS migrations via `Migrator` from `effect/unstable/sql`, shipped inside the package.
- Single-writer discipline via an Effect semaphore in the `EventStore` implementation; readers are free (WAL).

Schema (v1):

```sql
project (id TEXT PK, worktree TEXT UNIQUE NOT NULL, created_at INTEGER)
session (id TEXT PK, project_id TEXT FK, parent_session_id TEXT NULL,  -- compaction successor / subagent parent
         title TEXT NULL, prompt_spec TEXT NOT NULL, prompt_spec_hash TEXT NOT NULL,
         created_at INTEGER)
event   (session_id TEXT, seq INTEGER, id TEXT, type TEXT, version INTEGER,
         payload TEXT, created_at INTEGER,
         PRIMARY KEY (session_id, seq))
blob    (hash TEXT PK, size INTEGER, data BLOB)   -- payloads > 16 KiB stored as {"$blob": hash}
kv      (namespace TEXT, key TEXT, value TEXT, PRIMARY KEY (namespace, key))
```

All row payloads validate through Effect Schema at the boundary (`SqlSchema`); the DB never launders bad data into the domain.

## 8. Providers (`@hena-dev/provider-tanstack`)

- Implements the `LanguageModel` port by wrapping **TanStack AI** adapters. v1 adapters: **Anthropic** and **OpenAI-compatible** (OpenAI, OpenRouter, Ollama, local servers).
- Responsibilities: PromptSpec + messages → deterministic provider request (canonical ordering; cache breakpoints per §5.2); provider stream → `model.delta` ephemerals + consolidated durable events; usage extraction (incl. cache metrics) → `model.usage`.
- Two adapters from day one keep the port honest (one adapter always overfits).
- Future: `@hena-dev/provider-effect-ai` bridging `effect/unstable/ai` (`LanguageModel`, `Prompt`) as a swap-in proof of the port. Not in v1.

## 9. Tools (`@hena-dev/tools-fs`, `@hena-dev/tools-shell`)

- `fs`: `read`, `write`, `edit` (exact string replace), `glob`, `grep`. Rooted at the project worktree. This is also how the agent edits its own extensions and skills.
- `shell`: bash execution via the `ShellExecutor` port. **No sandbox in v1** (local dev machine, self-improvement requires running tests/builds). Sandbox implementations (TanStack-style adapters) are future `ShellExecutor` layers.
- `skill`: provided by the skills extension (§10).
- Safety in v1 = **permissions, not isolation**: `@hena-dev/permissions` registers `approveToolCall` policies (e.g. shell always asks; fs writes outside worktree ask) and emits `tool.approval.requested` → resolved from the Web UI. Auto-approve rules are configurable per project.

## 10. Skills (`@hena-dev/skills`)

- **SKILL.md convention** (agentskills-compatible): directory with frontmatter `name` + `description`, body is the instruction payload; may reference sibling files.
- Discovery: `<worktree>/.hena/skills/*/SKILL.md` + `~/.hena/skills/*/SKILL.md`; project wins on conflict. Watched like extensions.
- Progressive disclosure under the freeze rule: descriptors (name + description) are compiled into the PromptSpec at session creation; the `skill` tool loads full bodies on demand as appended tool results.
- The agent writes skills with `fs` tools: **skills = prose-tier self-improvement; extensions = code-tier self-improvement.** New/changed skills apply to new sessions only (descriptors are frozen); newly written skill *bodies* of already-frozen descriptors hot-swap like implementations.

## 11. Server (`@hena-dev/server`)

An extension, not core. Built on `effect/unstable/httpapi` + `@effect/platform-bun`. Localhost-only, no auth in v1.

| Endpoint | Protocol | Purpose |
|---|---|---|
| `POST /api/session/:id/chat` | **TanStack AI stream protocol** | chat turns; `@tanstack/ai-client` consumes it natively |
| `GET /api/events` (+ `?session=`) | SSE | live event stream (durable + ephemeral) for the inspector |
| `GET/POST /api/sessions` | REST (Schema-derived, OpenAPI for free) | list/create sessions (create = freeze PromptSpec) |
| `GET /api/projects`, `/api/skills`, `/api/extensions` | REST | listings + extension lifecycle status |
| `POST /api/approvals/:id` | REST | resolve pending tool approvals |
| `/` | static | Web UI assets (built by `@hena-dev/web`) |

The chat endpoint is itself replaceable — someone can ship a different protocol extension without touching anything else.

## 12. Web UI (`@hena-dev/web`)

React + Vite + `@tanstack/ai-client` / `@tanstack/ai-react`. Deliberately crude. Four surfaces:

1. **Chat** — streaming text, tool-call rendering.
2. **Approvals** — inline approve/deny for pending tool calls.
3. **Event inspector** — live SSE view of the raw event log: extension reload/failure/rollback events, cache-hit metrics from `model.usage`. *This is the demo of the entire philosophy: watch the agent rewrite itself, then open a new session and watch it use what it built.*
4. **Sessions** — opencode-style left sidebar: session list + a **New Session** button. Starting a new session is the ordinary, everyday action (one click) — and it is also the moment new capabilities, skills, and prompt changes take effect. Compaction lineage shown per session.

## 13. CLI (`@hena-dev/cli`)

Built on `effect/unstable/cli`. v1 commands:

- `hena serve [--port 4400]` — start server + Web UI for the current worktree.
- `hena init` — scaffold `.hena/` (extensions/, skills/, optional `hena.config.ts`).
- `hena db path` — print the global DB path.

Composition: `hena.config.ts` (optional) with `defineConfig({ extensions: [...] })` for static packages; dynamic dirs discovered by convention — **the agent never edits config to gain capabilities.** Sensible zero-config default: persistence + provider (from env keys) + fs/shell tools + skills + permissions + compaction + server.

## 14. Monorepo

Bun workspaces + Turborepo. ESM-only, `"type": "module"`, subpath export maps, `tsc`-built `dist/` per package. TypeScript strict across `.ts`, `.tsx`, `.mts`, and `.cts`. Every package: `src/` of tiny single-purpose modules (TanStack AI style), colocated tests.

```
packages/
  core/                # primitives: event, envelope, registry, reducer, loop, step,
                       #   prompt-spec, canonical, hash, ports/*, hooks/*, tool, extension, errors, ids
  extension-runtime/   # watcher, loader (cache-busted import), lifecycle, swap, rollback
  persistence-sqlite/  # EventStore/session queries, migrations, blob store, global path
  provider-tanstack/   # LanguageModel impl: anthropic, openai-compat, canonical requests, usage
  tools-fs/            # read, write, edit, glob, grep
  tools-shell/         # ShellExecutor port impl + shell tool
  skills/              # SKILL.md parse/discover/watch, descriptors, skill tool
  compaction/          # successor-session compaction, token budget, summarizer
  permissions/         # approveToolCall policies + approval events
  server/              # httpapi routes, SSE, TanStack chat endpoint, static serving
  web/                 # React + Vite UI (builds static assets consumed by server)
  cli/                 # hena binary: serve, init, db; defineConfig; composition root
  testkit/             # in-memory EventStore, scripted LanguageModel, event fixtures, layer helpers
  ci-gates/            # metrics/comment/workspace gates + CI summary; imports core as JIT-link fixture (D25)
```

Dependency direction: everything depends on `core` (and `testkit` in tests); `core` depends only on `effect`; `cli` is the composition root. Nothing else depends on anything else unless listed.

**Effect version policy**: exact-pin `effect@4.0.0-rc.112` + matching rc for `@effect/platform-bun`, `@effect/sql-sqlite-bun`, `@effect/vitest`, single version across the workspace, upgraded in one PR, quickly, as RCs land (D7).

## 15. Tooling & quality

- **Lint**: oxlint. **Format**: oxfmt. No Biome, no ESLint, no Prettier.
- **Tests**: Vitest + `@effect/vitest` (`it.effect`, TestClock, scoped layers). Determinism-critical suites: canonical form golden bytes, PromptSpec hash stability, reducer folds, reload state machine, freeze-rule enforcement (interface change mid-session must fail the cache guard).
- **Turborepo tasks**: per-package `build`, `typecheck`, `test`, `mutation`; repo-wide cached lint, format, type-ban, duplication, dead-code, metrics, comment, and workspace-contract tasks. CI runs the same graph.
- **Quality gates**: the full regime (coverage 100%, mutation score 100, cyclomatic/cognitive < 22, Halstead difficulty < 80, LOC/file < 500, CRAP < 25 derived, knip/jscpd zeros, `any`/`unknown` ban) lives in [`monorepo-quality-gates.md`](./monorepo-quality-gates.md) (D25).
- **Versioning**: no changesets. Fixed workspace version, manual bumps. `private: true` (publishable-shaped: exports maps, files, licenses) until the extension API survives subagents (v1.5), then public `0.x`.

## 16. Roadmap

- **v1**: everything in §4–§13. Definition of done: using only the Web UI, ask the agent to write a new tool extension; watch `extension.loaded` in the inspector; open a new session; the agent uses its own tool — with the inspector showing ~100% prefix-cache reads on every turn ≥ 2.
- **v1.5 — Subagents**: child sessions (`parent_session_id`) with fresh frozen specs; parent delegates via a `task` tool; this is both the extension-API stress test and the sanctioned way new capabilities reach an ongoing conversation.
- **v2+**: MCP (client/server extensions), sandboxed `ShellExecutor` adapters, restart/worker `ExtensionRuntime` strategies, `provider-effect-ai` bridge, remote/multi-user server + auth, snapshot store, alternative persistence backends.

## 17. Risks

| Risk | Mitigation |
|---|---|
| Effect v4 RC API churn (esp. `unstable/*`) | Exact pin; single-PR upgrades; `unstable` imports concentrated in extension packages; core surface is small |
| TanStack AI is 0.x and moves fast | Wrapped behind the `LanguageModel` port in one package; protocol coupling limited to one server endpoint + web client |
| Cache assumptions vs provider reality (TTLs, breakpoint rules) | Cache guard hash assertions + provider-reported cache metrics in the inspector; per-provider breakpoint logic isolated in the provider package. TTL-expiry misses are accepted as unavoidable |
| Hot-reload memory growth (retained old modules) | Accepted for dev-machine scope; restart escape hatch; worker strategy later |
| Agent writes malicious/broken code into its own extensions | healthCheck + last-good rollback; permissions hooks on fs/shell; no sandbox in v1 is an explicit accepted risk |
| oxfmt/oxlint maturity gaps | Both are replaceable line items in package.json; no code coupling |

## 18. Deliberately out of scope (v1)

TUI, MCP, sandboxing, auth/multi-user, remote deployment, snapshots, thread rebase (permanently out — D20), changesets/publishing, non-Bun runtime support for the app tier.
