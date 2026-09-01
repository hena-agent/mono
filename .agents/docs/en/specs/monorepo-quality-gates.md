# hena mono — Monorepo Tooling & Quality Gates

- **Status**: Draft v1 (grilling session complete, pending final review)
- **Date**: 2026-08-31
- **Repo**: `hena-agent/mono` (greenfield, no commits yet)
- **Companion**: [`extensible-ai-agent.md`](./extensible-ai-agent.md) — this spec concretizes D7/D10/D24 and **amends** it (see §12)

## 1. Purpose & principles

This spec defines the monorepo scaffold (bun + TypeScript + Turborepo, all packages under `packages/*`) and the CI quality-gate regime for the hena repo.

1. **Literal thresholds.** Every gate is enforced exactly as stated, with strict `<` semantics. "100%" means 100%. "0" means 0.
2. **Config over comments.** No inline suppression of any gate, ever. The escape hatch for a misfiring rule is a reviewed config change, visible in diff — never a comment. (Single exception: justified `// Stryker disable … : <reason>` for provably equivalent mutants, §7.9.)
3. **Uniform scope.** Static gates apply to **all committed TypeScript** — `src/`, tests, configs, gate scripts. Tests are code. Only coverage and mutation are src-only by nature.
4. **Gate code is production code.** Custom gate logic lives in a workspace package (`packages/ci-gates`) with 100% coverage and mutation testing, because a bug there silently disables a gate — the worst failure mode in this design.
5. **Exact pins.** Every dependency (toolchain included) is exact-pinned; `bun.lock` committed; manual upgrade PRs; no update bot. Extends hena D7 to the whole toolchain.

## 2. Requirements → gates

| Requirement | Threshold (literal) | Enforced as | Mechanism |
|---|---|---|---|
| Cyclomatic complexity | < 22 | max 21 **per function** | oxlint `complexity` |
| Cognitive complexity | < 22 | max 21 **per function** | `oxlint-plugin-complexity` (oxlint JS plugin) |
| Halstead difficulty | < 80 | `difficulty < 80` **per file** | fta JSON + `ci-gates` script |
| Lines of code per file | < 500 | max 499 **physical lines** (blanks/comments count) | oxlint `max-lines` |
| Test coverage | 100% | lines/functions/branches/statements = 100 **per package**, src, untested files included | vitest v8 provider thresholds |
| CRAP | < 25 | **derived invariant** (see §7.8) | documented + printed in CI summary |
| Surviving mutants | 0 | mutation score 100 (`survived` + `noCoverage` = 0) per package | Stryker + vitest runner, `thresholds.break: 100` |
| Dead code | 0 | knip exits non-zero on any finding | knip (default mode, repo root) |
| Redundant code | 0 | zero clones ≥ 70 tokens / 8 lines, cross-package | jscpd, threshold 0 |
| `any` / `unknown` types | 0 | zero type tokens in all committed TS, no suppressions | ast-grep + oxlint `typescript/no-explicit-any` + TS `strict` |

## 3. Decision log

| # | Decision | Choice |
|---|---|---|
| G1 | Deliverable flow | Spec → user review → scaffold implementation |
| G2 | TypeScript | **7.0.2 (native compiler)**, exact pin; fallback to 6.x/5.9 is a one-line change |
| G3 | Threshold semantics | Strict `<` literally; granularity per §2; static gates on all committed TS |
| G4 | Coverage layout | Per package, all four metrics 100; **coverage-ignore comments forbidden** (grep-gated) |
| G5 | CRAP | Derived invariant (implied by G4 + G3); no dedicated tool; printed in CI summary |
| G6 | `any`/`unknown` | Hard token ban via ast-grep, no suppression mechanism; core types redesigned around `Json` (amends hena spec §4.1/§5.1) |
| G7 | Cognitive complexity tool | `oxlint-plugin-complexity` (community oxlint JS plugin), exact-pinned; fallback: write our own plugin |
| G8 | Redundancy | jscpd: `minTokens: 70`, `minLines: 8`, `threshold: 0`, all committed TS, root-level (cross-package clones visible) |
| G9 | Mutation schedule | Full run per changed package per PR (turbo cache skips unchanged); weekly `--force` full run + `workflow_dispatch` |
| G10 | Equivalent mutants | `// Stryker disable … : <reason>` allowed **only with justification**; naked disables fail the grep gate; survivors stay literal 0 |
| G11 | knip mode | Default mode (test usage counts as used) at repo root; revisit production mode when `testkit` exists |
| G12 | CI shape | Two jobs (`checks`, `mutation`) on `pull_request` + `push` to `main`; concurrency cancel-in-progress; no merge queue; `actions/cache` for `.turbo`; `ubuntu-latest` |
| G13 | Seed package | `packages/core` with `json.ts` + `canonical.ts` + `hash.ts` and full tests — real hena §5.2 work, exercises every gate from commit 1 |
| G14 | Pinning | Exact versions everywhere; `packageManager: "bun@1.4.0"` as single bun-version source |
| G15 | Internal linkage | **JIT source exports** (`exports` → `./src/index.ts`); `build` (tsc dist emit) is a CI gate, nothing in dev/test depends on it |
| G16 | tsconfig | Maximal strictness incl. `isolatedDeclarations` + `erasableSyntaxOnly`; `module: nodenext` + `.ts` specifiers + `rewriteRelativeImportExtensions` |
| G17 | Gate placement | Per-package: `typecheck`, `build`, `test`, `mutation`. Root turbo tasks: `lint`, `fmt`, `ban-types`, `dupes`, `knip`, `metrics`, `gate-comments` |
| G18 | Lint suppressions | **Total ban** on `oxlint-disable`/`eslint-disable` comments; rules are fixed in config or turned off in config |
| G19 | Formatting | oxfmt defaults untouched, minimal `.oxfmtrc.json` |
| G20 | TS suppressions | `@ts-ignore`/`@ts-nocheck` banned everywhere; `@ts-expect-error` banned in `src/`, allowed in `*.test.ts`/`*.test-d.ts` (assertion, not suppression) |
| G21 | Gate code | Real workspace package `packages/ci-gates`, fully gated itself |
| G22 | License | MIT |
| G23 | Slug/doc | This file: `monorepo-quality-gates.md`, mirrors existing spec conventions |

## 4. Toolchain (exact pins at scaffold time)

| Tool | Version | Role |
|---|---|---|
| bun | 1.4.0 (`packageManager`) | package manager + TS runtime |
| typescript | 7.0.2 | typecheck + dist emit (native compiler; no JS compiler API — no gate tool depends on it) |
| turbo | 2.10.12 | task graph + caching |
| oxlint | 1.80.0 | lint; cyclomatic (`complexity`), `max-lines`, `typescript/no-explicit-any` |
| oxlint-plugin-complexity | 2.1.8 | cognitive complexity (oxlint JS plugin; peer: `oxc-parser`) |
| oxfmt | 0.65.0 | formatting (`--check` in CI) |
| vitest | 4.1.11 | test runner + v8 coverage |
| @effect/vitest | 4.0.0-rc.112 | `it.effect`, TestClock etc. (peers: `vitest >=4.1 <5`, `effect ^4.0.0-rc.112`) |
| effect | 4.0.0-rc.112 | per hena D7 |
| @stryker-mutator/core + vitest-runner | 10.0.0 | mutation testing |
| knip | 6.33.0 | dead code |
| jscpd | 5.1.0 | duplication |
| fta-cli | 3.0.1 | Halstead metrics (`runFta(path, { json: true })`) |
| @ast-grep/cli | 0.45.3 | `any`/`unknown` token ban (TS-version-independent) |

Node 24 is pinned in CI (`actions/setup-node`) because vitest/Stryker bins execute under Node via shebang; bun is the package manager and app runtime, not the test-runner runtime.

## 5. Repository layout

```
package.json              # private, workspaces ["packages/*"], packageManager bun@1.4.0, license MIT
bun.lock
turbo.json
tsconfig.base.json
.oxlintrc.json
.oxfmtrc.json
knip.json
.jscpd.json
fta.json
sgconfig.yml + rules/ban-any-unknown.yml
.github/workflows/ci.yml
.github/workflows/weekly.yml
.gitignore                # node_modules/ dist/ .turbo/ coverage/ reports/ *.tsbuildinfo
packages/
  core/                   # seed: json.ts, canonical.ts, hash.ts (+ *.test.ts)
  ci-gates/               # halstead gate, banned-comment scan, CI summary (+ tests)
```

Every package:

```jsonc
{
  "name": "@hena-dev/core",
  "type": "module",
  "private": true,
  "license": "MIT",
  "exports": { ".": "./src/index.ts" },          // JIT source exports (G15)
  "scripts": {
    "typecheck": "tsc --noEmit",
    "build": "tsc -p tsconfig.build.json",       // dist/ + dts; publishability gate only
    "test": "vitest run --coverage",
    "mutation": "stryker run"
  }
}
```

At publish time (far future, per hena D24 `private` until API stabilizes), exports flip to `dist/` — a mechanical change. If TS `nodenext` resolution of `.ts` export targets misbehaves under TS 7, the recorded fallback is explicit `types` conditions or a dev-only resolution tweak — to be verified at scaffold (§13).

## 6. TypeScript configuration

`tsconfig.base.json` (packages extend; `tsconfig.build.json` narrows to `src/` and enables emit):

```jsonc
{
  "compilerOptions": {
    "target": "esnext",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noPropertyAccessFromIndexSignature": true,
    "verbatimModuleSyntax": true,
    "isolatedDeclarations": true,        // explicit types on all exports; fast parallel dts
    "erasableSyntaxOnly": true,          // no enums/namespaces/param-properties; bun ≡ tsc semantics
    "allowImportingTsExtensions": true,  // relative imports written with .ts
    "rewriteRelativeImportExtensions": true, // emitted dist gets .js
    "skipLibCheck": true,
    "declaration": true,
    "declarationMap": true
  }
}
```

## 7. The gates

### 7.1 Format — `//#fmt`

`oxfmt --check .` with default style (G19). Failure = unformatted file.

### 7.2 Lint — `//#lint`

One repo-wide `oxlint` invocation (`.oxlintrc.json` at root). Baseline: categories `correctness` + `suspicious` at `error`, plus the gate rules below. Rule-set breadth beyond the gates is reviewable config, not spec — the config-over-comments principle (G18) makes every adjustment a visible diff.

### 7.3 Cyclomatic complexity — in `//#lint`

```jsonc
"rules": { "complexity": ["error", { "max": 21 }] }   // per function; 21 enforces < 22
```

### 7.4 Cognitive complexity — in `//#lint`

`oxlint-plugin-complexity` registered as an oxlint JS plugin, cognitive max 21. Exact option names verified at scaffold against the pinned plugin version (its rule surface changed at v2: combined `complexity` rule). Fallback if the plugin rots: implement the Sonar cognitive-complexity algorithm as our own oxlint JS plugin (~150 lines, owned).

### 7.5 Lines of code per file — in `//#lint`

```jsonc
"rules": { "max-lines": ["error", { "max": 499, "skipBlankLines": false, "skipComments": false }] }
```

Physical lines — blanks and comments count (strictest reading of "LOC per file < 500").

### 7.6 Halstead difficulty — `//#metrics`

`ci-gates` calls `runFta` (fta-cli) over all committed TS (tests included, `dist/` excluded via `fta.json`), asserts `halstead.difficulty < 80` for every file, and fails listing offenders. fta's built-in `score_cap` gates only the composite FTA score, hence the script.

### 7.7 Coverage 100% — per-package `test`

Per-package `vitest.config.ts`:

```ts
coverage: {
  provider: "v8",
  include: ["src/**/*.ts"],   // explicit: untested files count against 100%
  thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
}
```

- **Ignore comments are forbidden**: `v8 ignore`, `c8 ignore`, `istanbul ignore`, `node:coverage ignore` are banned strings (§7.13). If something is "untestable", the seam is wrong — put it behind a port with a testkit fake (hena §4.5/§14).
- Vitest 4's AST-aware v8 remapping keeps 100% honest (no transpilation phantom branches).

### 7.8 CRAP < 25 — derived invariant

CRAP(f) = CC(f)² × (1 − cov(f))³ + CC(f). The coverage gate forces cov = 1 for every function (aggregate 100% across all four metrics ⇒ every function fully covered, since ignores are banned), so **CRAP(f) = CC(f) ≤ 21 < 25** — guaranteed by §7.3 + §7.7. No dedicated tool can add information; `ci-gates` prints the derivation with the current max CC into the CI summary so the invariant stays visible.

### 7.9 Surviving mutants = 0 — per-package `mutation`

Per-package `stryker.config.json`: vitest runner, `mutate: ["src/**/*.ts"]`, `thresholds: { break: 100 }` (both `survived` and `noCoverage` break the build), `coverageAnalysis: "perTest"`.

- **Schedule (G9)**: turbo caches `mutation` per package — unchanged packages cost nothing on PRs; changed packages get a full, deterministic run (no incremental-state trust issues). Weekly workflow re-runs everything with `--force` to catch rot (flaky kills, tool drift).
- **Equivalent mutants (G10)**: mathematically unavoidable. `// Stryker disable next-line all: <reason>` is permitted; the `gate-comments` scan fails any `Stryker disable` lacking a `: reason`, and the CI summary lists every disable with its justification (auditable).
- **No TypeScript checker plugin**: it needs the TS JS compiler API, which TS 7 doesn't provide. Acceptable: vitest transpiles via esbuild, so type-invalid mutants either die to tests or become `RuntimeError` (excluded from score).

### 7.10 Dead code = 0 — `//#knip`

`knip` at repo root, default mode (G11), workspace-aware `knip.json` (entries: each package's `exports`, `ci-gates` bins; vitest/stryker configs picked up by knip plugins). Any finding (unused file, export, type, dependency) exits non-zero.

### 7.11 Redundant code = 0 — `//#dupes`

`jscpd` at root over all committed TS: `minTokens: 70`, `minLines: 8`, `threshold: 0`, `dist/` ignored. Any clone at or above the floor fails. Floor tuned only via spec amendment (G8) — chosen to sit above Effect import/Layer boilerplate, below real copy-paste.

### 7.12 `any` / `unknown` = 0 — `//#ban-types`

ast-grep rule (TypeScript + TSX): any `predefined_type` node matching `^(any|unknown)$` is an error, across all committed TS. No suppression: `ast-grep-ignore` is itself a banned string (§7.13).

- Layered with: oxlint `typescript/no-explicit-any` (redundant, free) and TS `strict`/`noImplicitAny` (closes the implicit hole). Catch variables are implicitly `unknown` without the token — usable only via narrowing (Schema/Match), which is the intended discipline.
- **Boundary typing** uses core's recursive `Json` type (`packages/core/src/json.ts`, seeded — G13): `payload: Json`, `providerOptions: Record<string, Json>`, `inputJsonSchema: Json` (hena spec amended accordingly, §12). Foreign values enter via `Schema.decodeUnknown` without the caller ever writing the token; error causes are typed (`Json`, `globalThis.Error`, or tagged errors) instead of `cause: unknown`.
- Known Goodhart hole, accepted and named: `{} | null | undefined` is semantically `unknown`. Review culture handles what grammar cannot.

### 7.13 Suppression bans — `//#gate-comments`

`ci-gates` scans all git-tracked `.ts`/`.tsx` files for banned strings:

| Banned string | Scope |
|---|---|
| `@ts-ignore`, `@ts-nocheck` | everywhere |
| `@ts-expect-error` | everywhere **except** `*.test.ts` / `*.test-d.ts` (there it is a compile-failure assertion) |
| `oxlint-disable`*, `eslint-disable`* | everywhere |
| `v8 ignore`, `c8 ignore`, `istanbul ignore`, `node:coverage ignore` | everywhere |
| `ast-grep-ignore` | everywhere |
| `Stryker disable` without `: <reason>` | everywhere (`Stryker restore` is free) |

The scanner's own pattern constants are assembled by string concatenation at runtime so they never appear verbatim in source (it must survive its own scan and its own mutation testing).

## 8. Task graph

Per-package tasks (turbo-cached, parallel; JIT linkage means no `^build` anywhere in the dev path):

| Task | Command | dependsOn | Outputs |
|---|---|---|---|
| `typecheck` | `tsc --noEmit` (src + tests) | `^typecheck` (cache-correct upstream src hashing) | — |
| `build` | `tsc -p tsconfig.build.json` | `^build` | `dist/**` |
| `test` | `vitest run --coverage` | `^typecheck` | `coverage/**` |
| `mutation` | `stryker run` | `^typecheck` | `reports/mutation/**` |

Root tasks (`//#…`, cached on repo-wide inputs): `lint`, `fmt`, `ban-types`, `dupes`, `knip`, `metrics`, `gate-comments`.

Umbrellas: `bun run check` = `turbo run build typecheck test lint fmt ban-types dupes knip metrics gate-comments` (mutation excluded locally by default: `bun run check:full` includes it). `bun run fix` = `oxfmt --write . && oxlint --fix`.

## 9. CI (GitHub Actions)

### 9.1 `ci.yml`

- **Triggers**: `pull_request`, `push` to `main`; `concurrency` with cancel-in-progress per ref. No merge queue (solo-dev).
- **Job `checks`** (ubuntu-latest): checkout → `oven-sh/setup-bun` (`bun-version-file: package.json`; fallback: committed `.bun-version` if `packageManager` reading proves unsupported) → `actions/setup-node` (Node 24) → `bun install --frozen-lockfile` → `actions/cache` on `.turbo` (key: lockfile + ref) → `turbo run` all non-mutation tasks → `ci-gates summary` writes `$GITHUB_STEP_SUMMARY` (max Halstead difficulty, max CC + CRAP derivation, Stryker-disable audit list, clone/dead-code zeros).
- **Job `mutation`** (parallel, same setup): `turbo run mutation`.
- Both jobs are **required status checks** on `main` (branch protection via `gh api` once the repo is pushed; appendix in scaffold PR).

### 9.2 `weekly.yml`

`schedule: cron "0 6 * * 1"` + `workflow_dispatch`: full pipeline with `turbo run … --force` (cache bypassed) including mutation. Catches rot that per-PR caching can mask.

## 10. Seed: `packages/core` (G13)

Real hena §5.2 work, not throwaway:

- `json.ts` — recursive `Json` type (`string | number | boolean | null | readonly Json[] | { readonly [k: string]: Json }`) + guards. The cornerstone of the `unknown` ban (§7.12).
- `canonical.ts` — canonical JSON stringify: lexicographically sorted keys, UTF-8, no insignificant whitespace, normalized numbers, `undefined`/`NaN`/`±Infinity` rejected (hena §5.2 golden-byte requirements).
- `hash.ts` — `sha256Hex(input: string): Effect<string>` via WebCrypto (runtime-agnostic, per hena D6).
- Colocated `*.test.ts` using `@effect/vitest` (`it.effect` for `hash`), golden-byte fixtures for `canonical`. 100% coverage, 0 survivors, from commit 1.

`core` depends on `effect` only (hena §4 invariant holds from day one).

## 11. Seed: `packages/ci-gates` (G21)

- `halstead.ts` — fta JSON → per-file `difficulty < 80` assertion (§7.6).
- `comments.ts` — banned-string scan over `git ls-files` output (§7.13), concatenation-built patterns.
- `summary.ts` — CI summary writer (§9.1).
- Invoked by root turbo tasks via `bun packages/ci-gates/src/<bin>.ts`. Fully gated itself: 100% coverage, mutation, lint, types. Who gates the gates: the gates do.

## 12. Amendments to `extensible-ai-agent.md`

Applied together with this spec (agreed in grilling Q5):

1. §4.1 `EventEnvelope.payload: unknown` → `payload: Json` (validated by the registered Schema; `Json` from `@hena-dev/core`).
2. §5.1 `providerOptions: Record<string, unknown>` → `Record<string, Json>`; `inputJsonSchema: unknown` → `inputJsonSchema: Json`.
3. Decision log: new row **D25** referencing this spec; §15 gains a pointer to it; §14 package tree gains `ci-gates/`.

## 13. Scaffold verification checklist (implementation step, after review)

Ordered; each item proves a spec assumption before building on it:

1. `bun init` root + workspaces; exact-pin toolchain; commit lockfile.
2. Verify TS 7.0.2 accepts the full §6 option set and **resolves JIT `.ts` export targets under `nodenext`** (fallback per §5 if not).
3. Verify Effect `4.0.0-rc.112` + `@effect/vitest` rc typecheck under TS 7 (fallback: pin TS 6.x/5.9 — one line, G2).
4. Verify `oxlint-plugin-complexity` loads as JS plugin in oxlint 1.80 and confirm its rule/option names (fallback per §7.4).
5. Verify `setup-bun` reads `packageManager` (fallback: `.bun-version`).
6. Seed `core` + `ci-gates`; bring every gate red-green (deliberately break each gate once to prove it fails).
7. Push, enable branch protection with `checks` + `mutation` required.

## 14. Risks

| Risk | Mitigation |
|---|---|
| TS 7 (native) ecosystem gaps (Effect rc types, `.ts` export resolution) | Verified first in checklist; fallback pin to 6.x/5.9 is one line; no gate tool uses the TS JS API by design |
| oxfmt 0.65 / oxlint pre-2.0 churn | Exact pins; oxfmt has zero config surface here; both replaceable line items (hena §17 already accepts this) |
| `oxlint-plugin-complexity` is third-party | Exact pin; fallback: own ~150-line oxlint JS plugin implementing Sonar cognitive complexity |
| Equivalent mutants wedging CI at score 100 | Justified `Stryker disable` regime with audit trail (G10) |
| No Stryker TS checker under TS 7 | Type-invalid mutants die at runtime or count as `RuntimeError` (excluded); acceptable |
| jscpd floor (70/8) mis-tuned for Effect boilerplate | Floor changes are spec amendments, not silent config drift |
| `{} \| null \| undefined` smuggling past the `unknown` ban | Named and accepted; review culture, not grammar |
| 100%-coverage + 0-survivor cost on future UI package (`web`) | Uniform policy stands (G3); if reality disagrees, that is a spec amendment discussed then, not an exemption slipped in |

## 15. Out of scope (deferred)

- knip production/strict mode (revisit when `testkit` lands — G11)
- Publishing flip (`exports` → `dist/`, npm publish pipeline) — hena D24 keeps the repo private until the extension API stabilizes
- Renovate/update automation (manual exact-pin upgrades for now — G14)
- CI fan-out per gate, merge queue, remote turbo cache service (revisit on wall-clock pain — G12)
- `as`-cast policy (not in the requested gate set; candidate for a future amendment)
