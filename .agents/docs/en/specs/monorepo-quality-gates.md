# hena mono — Monorepo Tooling & Quality Gates

- **Status**: Implemented and fully verified (local gates and branch protection enabled; protected-branch integration pending)
- **Date**: 2026-09-02
- **Repo**: `hena-agent/mono` (initial project-spec commit on `main`; scaffold proposed in this PR)
- **Companion**: [`extensible-ai-agent.md`](./extensible-ai-agent.md) — this spec concretizes D7/D10/D24 and **amends** it (see §12)

## 1. Purpose & principles

This spec defines the monorepo scaffold (bun + TypeScript + Turborepo, all packages under `packages/*`) and the CI quality-gate regime for the hena repo.

1. **Literal thresholds.** Every gate is enforced exactly as stated, with strict `<` semantics. "100%" means 100%. "0" means 0.
2. **Config over comments.** No inline suppression of any gate, ever. The escape hatch for a misfiring rule is a reviewed config change, visible in diff — never a comment. (Single exception: justified `// Stryker disable … : <reason>` for provably equivalent mutants, §7.9.)
3. **Uniform scope.** Static gates apply to **all committed authored TypeScript** (`.ts`, `.tsx`, `.mts`, `.cts`) — `src/`, tests, configs, gate scripts. The sole exception is the committed generated OpenCode web-search bundle, whose source and generator live in `hena-agent/workspace`; the path is exact and review-visible in every relevant tool configuration. Local scans include tracked and nonignored untracked files; CI therefore covers the checked-out commit. Tests are code. Only coverage and mutation are src-only by nature.
4. **Gate code is production code.** Custom gate logic lives in a workspace package (`packages/ci-gates`) with 100% coverage and mutation testing, because a bug there silently disables a gate — the worst failure mode in this design.
5. **Exact pins.** Every dependency (toolchain included) is exact-pinned; immutable action SHAs and runtime pins are gate-checked; `bun.lock` committed; manual upgrade PRs; no update bot. Extends hena D7 to the whole toolchain.

## 2. Requirements → gates

| Requirement | Threshold (literal) | Enforced as | Mechanism |
|---|---|---|---|
| Cyclomatic complexity | < 22 | max 21 **per function** | oxlint `complexity` |
| Cognitive complexity | < 22 | max 21 **per function** | `oxlint-plugin-complexity` (oxlint JS plugin) |
| Halstead difficulty | < 80 | `difficulty < 80` **per file** | fta JSON + `ci-gates` script |
| Lines of code per file | < 500 | max 499 **physical lines** (blanks/comments count) | oxlint `max-lines` |
| Test coverage | 100% | lines/functions/branches/statements = 100 **per package**, src, untested files included and report ownership reconciled | vitest v8 thresholds + `ci-gates` coverage-file gate |
| CRAP | < 25 | **derived invariant** (see §7.8) | documented + printed in CI summary |
| Surviving mutants | 0 | mutation score 100 (`survived` + `noCoverage` = 0) per package | Stryker + vitest runner, `thresholds.break: 100` |
| Dead code | 0 | knip exits non-zero on any finding | knip (default mode, repo root) |
| Redundant code | 0 | zero clones ≥ 70 tokens / 8 lines, cross-package | jscpd, threshold 0 |
| `any` / `unknown` types | 0 | zero type tokens in all committed TS, no suppressions | ast-grep + oxlint `typescript/no-explicit-any` + TS `strict` |

## 3. Decision log

| # | Decision | Choice |
|---|---|---|
| G1 | Deliverable flow | Spec → user review → scaffold implementation |
| G2 | TypeScript | **7.0.2 native compiler** for `tsc`; Microsoft's official `@typescript/typescript6` side-by-side alias supplies the legacy API required by Stryker; Bun's hoisted linker makes `typescript` resolve to the compatibility API consistently on macOS and Linux |
| G3 | Threshold semantics | Strict `<` literally; granularity per §2; static gates on all committed TS |
| G4 | Coverage layout | Per package, all four metrics 100; every source must appear in `coverage-final.json` with authentic positive counters (empty maps allowed only for declarative root barrels); **coverage-ignore comments forbidden** (grep-gated) |
| G5 | CRAP | Derived invariant (implied by G4 + G3); no dedicated tool; printed in CI summary |
| G6 | `any`/`unknown` | Hard token ban via ast-grep, no suppression mechanism; core types redesigned around `Json` (amends hena spec §4.1/§5.1) |
| G7 | Cognitive complexity tool | `oxlint-plugin-complexity` (community oxlint JS plugin), exact-pinned; fallback: write our own plugin |
| G8 | Redundancy | jscpd: `minTokens: 70`, `minLines: 8`, `threshold: 0`, all committed TS, root-level with TS/TSX cross-format matching (cross-package clones visible) |
| G9 | Mutation schedule | Full run per changed package per PR (turbo cache skips unchanged); shared TS/Vitest configs are global cache inputs; weekly `--force` full run + `workflow_dispatch` |
| G10 | Equivalent mutants | `// Stryker disable … : <reason>` allowed **only with justification**; naked disables fail the grep gate; survivors stay literal 0 |
| G11 | knip mode | Default mode (test usage counts as used) at repo root; revisit production mode when `testkit` exists |
| G12 | CI shape | Two jobs (`checks`, `mutation`) on `pull_request` + `push` to `main`; concurrency cancel-in-progress; no merge queue; `actions/cache` for `.turbo`; `ubuntu-latest` |
| G13 | Seed package | `packages/core` with `json.ts` + `canonical.ts` + `hash.ts` and full tests — real hena §5.2 work, exercises every gate from commit 1 |
| G14 | Pinning | Exact versions everywhere, including immutable GitHub Action SHAs and Node 24.20.0; `packageManager: "bun@1.4.0"` as single bun-version source |
| G15 | Internal linkage | **JIT source exports** (`exports` → `./src/index.ts`); `ci-gates` imports `core` through its package export as a compile/runtime fixture; `build` (tsc dist emit) is a CI gate, nothing in dev/test depends on dist |
| G16 | tsconfig | Maximal strictness incl. `isolatedDeclarations` + `erasableSyntaxOnly`; `module: nodenext` + `.ts` specifiers + `rewriteRelativeImportExtensions` |
| G17 | Gate placement | Per-package: `typecheck`, `build`, `test`, `mutation`. Root turbo tasks: `typecheck-all`, `lint`, `fmt`, `ban-types`, `dupes`, `knip`, `metrics`, `gate-comments`, `pins`, `production-scope`, `workspace-scripts`; uncached post-gates: `static-scope`, `coverage-files`, `mutation-files` |
| G18 | Lint suppressions | **Total ban** on `oxlint-disable`/`eslint-disable` comments; rules are fixed in config or turned off in config |
| G19 | Formatting | oxfmt defaults untouched, minimal `.oxfmtrc.json` |
| G20 | TS suppressions | `@ts-ignore`/`@ts-nocheck` banned everywhere; `@ts-expect-error` banned in `src/`, allowed in `*.test.ts`/`*.test-d.ts` (assertion, not suppression) |
| G21 | Gate code | Real workspace package `packages/ci-gates`, fully gated itself |
| G22 | License | MIT |
| G23 | Slug/doc | This file: `monorepo-quality-gates.md`, mirrors existing spec conventions |
| G24 | Shared Vitest config | One root `vitest.config.mjs` is consumed per package; package-local copies violated the zero-duplication gate |
| G25 | Workspace contract | Root workspaces must equal `["packages/*"]`; symlinks anywhere under `packages/` are forbidden; `ci-gates` enumerates every package, requires existing, regular, real-path-contained TS-family, source-only, non-test export/import targets and the exact specified `build`, `typecheck`, `test`, and `mutation` commands before any package gate |
| G26 | Fail-closed FTA | Git discovery is authoritative; every TS file is staged with its original TS-family extension and short-file exclusion disabled, and any missing/unexpected result fails the gate |
| G27 | Fail-closed coverage | `ci-gates` reconciles every package source against Vitest's JSON report after tests and validates positive statement/function/branch counters, catching omitted files and fabricated empty/zero evidence |
| G28 | Fail-closed static scope | Uncached Git discovery rejects committed authored TS matched by Git ignore rules or generated directories excluded by static tools; lint/Knip disable ignore files, formatting disables nested configs and uses explicit TS globs, ast-grep includes hidden/dot/generic-ignore/global paths, and jscpd disables gitignore while retaining explicit generated exclusions |
| G29 | Pinning invariant | `ci-gates` parses workflow and local composite-action YAML; inspects only job steps, reusable-workflow jobs, and composite-action steps; rejects dependency/override/resolution ranges, nonexact Bun/Node versions per action invocation, Bun-version overrides, changed Stryker scope/thresholds, and GitHub Actions not referenced by full commit SHA |
| G30 | Fail-closed mutation | Stryker selects all package source; package barrels are constrained to re-exports, and a post-gate rejects malformed metadata/mutants/locations, wrong roots, stale source snapshots, unexpected or missing files, surviving outcomes, and empty reports |
| G31 | Production/test separation | OXC-decoded production imports/exports cannot reference test-suffixed modules, called CommonJS loaders and dynamic imports are forbidden, repository-local TypeScript config inheritance is traversed to reject remapping, external config inheritance is forbidden, package exports/import aliases cannot target tests, and AST-confirmed root source barrels cannot contain executable code |

## 4. Toolchain (exact pins at scaffold time)

| Tool | Version | Role |
|---|---|---|
| bun | 1.4.0 (`packageManager`) | package manager + TS runtime |
| `@typescript/native` (`npm:typescript`) | 7.0.2 | native `tsc` used for typecheck + dist emit |
| `typescript` (`npm:@typescript/typescript6`) | 6.0.2 wrapper (TS API 6.0.3) | official side-by-side compatibility API required internally by Stryker 10; JSONC parsing for structural tsconfig enforcement |
| turbo | 2.10.12 | task graph + caching |
| oxlint | 1.80.0 | lint; cyclomatic (`complexity`), `max-lines`, `typescript/no-explicit-any` |
| oxlint-plugin-complexity | 2.1.8 | cognitive complexity (oxlint JS plugin; peer: `oxc-parser`) |
| oxfmt | 0.65.0 | formatting (`--check` in CI) |
| vitest | 4.1.11 | test runner + v8 coverage |
| @effect/vitest | 4.0.0-rc.112 | `it.effect`, TestClock etc. (peers: `vitest >=4.1 <5`, `effect ^4.0.0-rc.112`) |
| effect | 4.0.0-rc.112 | per hena D7 |
| @stryker-mutator/core + vitest-runner | 10.0.0 | mutation testing |
| knip | 6.34.0 | dead code |
| jscpd | 5.1.1 | duplication |
| fta-cli | 3.0.1 | Halstead metrics (`runFta(path, { json: true })`) |
| yaml | 2.9.0 | structural GitHub workflow parsing for per-invocation pin enforcement |
| oxc-parser | 0.148.0 | decoded TS module records and production parse validation |
| @ast-grep/cli | 0.45.3 | `any`/`unknown` token ban (TS-version-independent) |
| Node / @types/node | 24.20.0 / 24.13.3 | exact CI runtime and matching-major gate-code types |

Node 24.20.0 is pinned in CI (`actions/setup-node`) because vitest/Stryker bins execute under Node via shebang; bun is the package manager and app runtime, not the test-runner runtime.

## 5. Repository layout

```
package.json              # private, workspaces ["packages/*"], packageManager bun@1.4.0, license MIT
bun.lock
bunfig.toml              # hoisted linker keeps TS 6 API resolution deterministic beside native TS 7
turbo.json
tsconfig.base.json
tsconfig.all.json          # strict no-emit pass over every committed TS-family file
.oxlintrc.json
.oxfmtrc.json
knip.json
.jscpd.json
sgconfig.yml + rules/ban-any-unknown{,-tsx}.yml
vitest.config.mjs       # shared config; invoked with each package as root (G24)
.github/workflows/ci.yml
.github/workflows/weekly.yml
.gitignore                # node_modules/ dist/ .turbo/ coverage/ reports/ *.tsbuildinfo
packages/
  core/                   # seed: json.ts, canonical.ts, hash.ts (+ *.test.ts)
  ci-gates/               # metrics, coverage/comment/workspace gates, CI summary (+ tests)
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
    "build": "rm -rf dist && tsc -p tsconfig.build.json", // clean dist + dts; publishability gate only
    "test": "vitest run --root . --config ../../vitest.config.mjs --coverage",
    "mutation": "stryker run"
  }
}
```

At publish time (far future, per hena D24 `private` until API stabilizes), exports flip to `dist/` — a mechanical change. Native TS 7 `nodenext` resolution of the JIT `.ts` export target is exercised by `ci-gates` importing `Json` and `isJson` from `@hena-dev/core`; the consumer build and runtime tests do not read dist (§13).

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

`oxfmt --check --disable-nested-config` with default style (G19), explicit TS-family globs, an empty ignore source, and only generated-directory exclusions. Failure = unformatted file. `static-scope` prevents committed TS from occupying an excluded directory (§7.14).

### 7.2 Lint — `//#lint`

One repo-wide `oxlint --no-ignore` invocation (`.oxlintrc.json` at root). Baseline: categories `correctness` + `suspicious` at `error`, plus the gate rules below. Rule-set breadth beyond the gates is reviewable config, not spec — the config-over-comments principle (G18) makes every adjustment a visible diff.

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

`ci-gates` discovers all TS through NUL-delimited `git ls-files --cached --others --exclude-standard`, stages exactly that set under parser-compatible synthetic names that preserve `.ts`/`.tsx`/`.mts`/`.cts`, and calls `runFta` with `exclude_under: 0`. It requires a one-to-one result mapping before asserting `halstead.difficulty < 80` per file, so short files, root files, declarations, parser omissions, duplicates, and unexpected results fail closed. fta's built-in `score_cap` gates only the composite FTA score, hence the script.

### 7.7 Coverage 100% — per-package `test`

The shared root `vitest.config.mjs` is invoked separately with each package as `--root .`, preserving per-package thresholds without duplicate config files (G24):

```ts
coverage: {
  provider: "v8",
  include: ["src/**/*.{ts,tsx,mts,cts}"], // explicit: untested files count against 100%
  thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
}
```

- **Ignore comments are forbidden**: `v8 ignore`, `c8 ignore`, `istanbul ignore`, `node:coverage ignore` are banned strings (§7.13). If something is "untestable", the seam is wrong — put it behind a port with a testkit fake (hena §4.5/§14).
- Vitest 4's AST-aware v8 remapping keeps 100% honest (no transpilation phantom branches).
- **Report reconciliation (G27)**: after every root `test`/`check` run, `coverage-files` compares git-discovered package source against each package-owned `coverage-final.json`. Missing reports/source entries, malformed maps, empty implementation evidence, and nonpositive counters fail; only a root barrel proven declarative by `production-scope` may have empty maps. This closes both V8 remapper omissions and fabricated/vacuous 100% evidence.

### 7.8 CRAP < 25 — derived invariant

CRAP(f) = CC(f)² × (1 − cov(f))³ + CC(f). The coverage gate forces cov = 1 for every function (aggregate 100% across all four metrics ⇒ every function fully covered, since ignores are banned), so **CRAP(f) = CC(f) ≤ 21 < 25** — guaranteed by §7.3 + §7.7. No dedicated tool can add information; `ci-gates` prints the derivation with the current max CC into the CI summary so the invariant stays visible.

### 7.9 Surviving mutants = 0 — per-package `mutation`

Per-package `stryker.config.json`: vitest runner, exact full-source mutate/include and test-exclude patterns with barrels included, all thresholds 100 (both `survived` and `noCoverage` break the build), `coverageAnalysis: "perTest"`. The pin gate prevents narrowing this scope. The root `mutation-files` post-gate requires every package report to be nonempty with exact project root, live source snapshots, expected file set, killed/timeout outcomes, and one-based in-source ordered locations; this rejects stale or forged evidence and Stryker's otherwise-successful empty `NaN` score.

- **Schedule (G9)**: turbo caches `mutation` per package — unchanged packages cost nothing on PRs; changed packages get a full, deterministic run (no incremental-state trust issues). Weekly workflow re-runs everything with `--force` to catch rot (flaky kills, tool drift).
- **Equivalent mutants (G10)**: mathematically unavoidable. `// Stryker disable next-line all: <reason>` is permitted; the `gate-comments` scan fails any `Stryker disable` lacking a `: reason`, and the CI summary lists every disable with its justification (auditable).
- **TS 7 compatibility**: Stryker core itself still imports the legacy compiler API to rewrite tsconfig files. The official Microsoft side-by-side setup keeps `tsc` on native TS 7 while aliasing `typescript` to `@typescript/typescript6` for API consumers. `bunfig.toml` selects the hoisted linker because Bun's isolated Linux layout otherwise resolves Stryker's internal bare import to the native package by real path. No optional Stryker TypeScript checker is enabled.

### 7.10 Dead code = 0 — `//#knip`

`knip --no-gitignore` at repo root in default workspace-aware mode (G11), with only generated build/coverage/mutation trees explicitly excluded; package exports and Vitest/Stryker configuration are discovered by Knip's built-in workspace/plugins support. Any finding (unused file, export, type, dependency) exits non-zero.

### 7.11 Redundant code = 0 — `//#dupes`

`jscpd --no-gitignore` runs from `.` over all TS with TypeScript and TSX cross-format matching: `minTokens: 70`, `minLines: 8`, `threshold: 0`, `maxSize: 1gb` (above GitHub's repository file limit), generated directories explicitly ignored. Any clone at or above the floor fails. Floor tuned only via spec amendment (G8) — chosen to sit above Effect import/Layer boilerplate, below real copy-paste.

### 7.12 `any` / `unknown` = 0 — `//#ban-types`

ast-grep rules (TypeScript + TSX): any `predefined_type` node matching `^(any|unknown)$` is an error across `.ts`, `.tsx`, `.mts`, and `.cts`, including hidden and globally ignored committed paths. No suppression: `ast-grep-ignore` is itself a banned string (§7.13).

- Layered with: oxlint `typescript/no-explicit-any` (redundant, free) and root `tsconfig.all.json` under TS `strict`/`noImplicitAny` (closes the implicit hole across source, tests, root files, and package configs). Catch variables are implicitly `unknown` without the token — usable only via narrowing (Schema/Match), which is the intended discipline.
- **Boundary typing** uses core's recursive `Json` type (`packages/core/src/json.ts`, seeded — G13): `payload: Json`, `providerOptions: Record<string, Json>`, `inputJsonSchema: Json` (hena spec amended accordingly, §12). Foreign values enter via `Schema.decodeUnknown` without the caller ever writing the token; error causes are typed (`Json`, `globalThis.Error`, or tagged errors) instead of `cause: unknown`.
- Known Goodhart hole, accepted and named: `{} | null | undefined` is semantically `unknown`. Review culture handles what grammar cannot.

### 7.13 Suppression bans — `//#gate-comments`

`ci-gates` scans all git-discovered `.ts`/`.tsx`/`.mts`/`.cts` files for banned strings:

| Banned string | Scope |
|---|---|
| `@ts-ignore`, `@ts-nocheck` | everywhere |
| `@ts-expect-error` | everywhere **except** `*.test.ts` / `*.test-d.ts` (there it is a compile-failure assertion) |
| `oxlint-disable`*, `eslint-disable`* | everywhere |
| `v8 ignore`, `c8 ignore`, `istanbul ignore`, `node:coverage ignore` | everywhere; arbitrary parser-accepted whitespace between words |
| `ast-grep-ignore` | everywhere |
| `Stryker disable` without `: <reason>` | everywhere (`Stryker restore` is free) |

The scanner's own pattern constants are assembled by string concatenation at runtime so they never appear verbatim in source (it must survive its own scan and its own mutation testing).

### 7.14 Static-tool scope — uncached `static-scope`

`ci-gates` uses the same NUL-delimited git discovery as the other custom gates and asks `git check-ignore --no-index` which discovered files match repository, parent, or global Git ignore rules. It rejects every match plus TS-family files under `node_modules`, `dist`, `coverage`, `reports`, `.turbo`, or `.stryker-tmp`. The exact generated `.opencode/plugin/codex-web-search.ts` bundle is excluded consistently from authored-code discovery and static tools. Therefore a force-added committed authored TS file cannot hide in an ignored or excluded tree: CI fails even when an underlying tool intentionally skips it. This gate runs after Turbo without caching because its result depends on the Git index and ignore engine, not only file content.

### 7.15 Exact pins — `//#pins`

`ci-gates` reads the root and every workspace manifest and rejects ranges across dependencies/dev/optional/peer/override/resolution fields. It parses each workflow and local `action.yml`/`action.yaml` as YAML, reads `uses` only from workflow job steps, reusable-workflow jobs, and composite-action steps, requires full 40-hex GitHub Action SHAs, associates every case-insensitive `setup-node` invocation with exact Node `24.20.0`, and rejects nonexact `setup-bun` overrides. It also requires `packageManager: "bun@1.4.0"` and exact full-source Stryker configurations; `bun install --frozen-lockfile` separately proves the committed lock matches the manifests.

### 7.16 Production/test separation — `//#production-scope`

`ci-gates` parses production TS-family files with OXC, rejects parse failures, detects decoded/escaped test-suffixed static import/export specifiers, rejects called `require`, TypeScript external-module references, and `process.getBuiltinModule`, and bans all dynamic imports so constructed test paths cannot evade inspection. TypeScript JSONC is parsed structurally across every `tsconfig*.json[c]` and its complete repository-local `extends` chain to reject `baseUrl`/`paths`/`rootDirs`/`moduleSuffixes`; external or repository-escaping inheritance is forbidden. Workspace exports and package import aliases must resolve to existing regular non-test TS-family files under the owning `src/`, all symlinks under `packages/` are forbidden, and shared OXC classification permits only nonempty declarative re-exports in root source barrels. Coverage and mutation therefore use the same barrel boundary without allowing executable production to hide in an excluded path.

## 8. Task graph

Per-package tasks (turbo-cached, parallel; JIT linkage means no `^build` anywhere in the dev path):

| Task | Command | dependsOn | Outputs |
|---|---|---|---|
| `typecheck` | `tsc --noEmit` (src + tests) | `//#workspace-scripts`, `^typecheck` | — |
| `build` | `rm -rf dist && tsc -p tsconfig.build.json` | `//#workspace-scripts`, `^build` | `dist/**` |
| `test` | `vitest run --coverage` | `//#workspace-scripts`, `^typecheck` | `coverage/**` |
| `mutation` | `stryker run` | `//#workspace-scripts`, `^typecheck` | `reports/mutation/**` |

Root tasks (`//#…`): repo-wide `typecheck-all`, `lint`, `fmt`, `ban-types`, `dupes`, `knip`, `metrics`, and `gate-comments`; Git-discovery-dependent `pins`, `production-scope`, and `workspace-scripts` are uncached. Package `test` and `mutation` use Turbo's package-local defaults plus dependency-task hashes instead of hashing the whole repository; `tsconfig.base.json` and `vitest.config.mjs` remain `globalDependencies`. The uncached `static-scope`, `coverage-files`, and `mutation-files` gates inspect current Git state and fresh/restored package reports after Turbo finishes.

Umbrellas: `bun run test` runs package tests then `coverage-files`; `bun run mutation` runs package mutation then `mutation-files`; `bun run check` runs all nonmutation gates then uncached `static-scope` and `coverage-files`; `bun run check:full` includes mutation and all three post-gates. `bun run fix` applies the explicit formatter scope then runs `oxlint --fix --no-ignore`.

## 9. CI (GitHub Actions)

### 9.1 `ci.yml`

- **Triggers**: `pull_request`, `push` to `main`; `concurrency` with cancel-in-progress per ref. No merge queue (solo-dev).
- **Job `checks`** (ubuntu-latest): immutable-SHA checkout → setup-bun (`packageManager` supplies Bun 1.4.0) → setup-node (Node 24.20.0) → `bun install --frozen-lockfile` → immutable-SHA `actions/cache` on `.turbo` (branch-scoped key: ref + lockfile + commit) → all non-mutation tasks → `ci-gates summary` writes `$GITHUB_STEP_SUMMARY` (max Halstead difficulty, max CC + CRAP derivation, Stryker-disable audit list, clone/dead-code zeros).
- **Job `mutation`** (parallel, same setup): `bun run mutation`, including report validation/source reconciliation.
- Both jobs are **strict required status checks** on `main`, enforced for administrators by branch protection.

### 9.2 `weekly.yml`

`schedule: cron "0 6 * * 1"` + `workflow_dispatch`: `bun run check:full:force` runs the full pipeline with Turbo `--force` (cache bypassed) including mutation and post-test coverage reconciliation. Catches rot that per-PR caching can mask.

## 10. Seed: `packages/core` (G13)

Real hena §5.2 work, not throwaway:

- `json.ts` — recursive `Json` type (`string | number | boolean | null | readonly Json[] | { readonly [k: string]: Json }`) + guards that reject nonfinite numbers, nonplain objects, accessors, hidden/symbol state, sparse/property-bearing arrays, and cycles while permitting shared subobjects. The cornerstone of the `unknown` ban (§7.12).
- `canonical.ts` — canonical JSON stringify: validates and snapshots inputs (rejecting proxies), lexicographically sorts keys, emits UTF-8 with no insignificant whitespace and normalized numbers, retains valid null properties, and rejects invalid/cyclic runtime values (hena §5.2 golden-byte requirements).
- `hash.ts` — `sha256Hex(input: string): Effect<string>` via WebCrypto (runtime-agnostic, per hena D6).
- Colocated `*.test.ts` using `@effect/vitest` (`it.effect` for `hash`), golden-byte fixtures for `canonical`. 100% coverage, 0 survivors, from commit 1.

`core` depends on `effect` only (hena §4 invariant holds from day one).

## 11. Seed: `packages/ci-gates` (G21)

- `metrics.ts` — fail-closed FTA staging/result reconciliation plus per-file `difficulty < 80`, cyclomatic/cognitive maxima, and derived CRAP reporting (§7.6–§7.8).
- `coverage.ts` — package-owned post-test source/report/counter reconciliation that catches V8 omissions, empty/zero evidence, and cross-package report substitution (G4/G27).
- `files.ts` — authoritative TS discovery plus rejection of files in static-tool-excluded generated directories (G28).
- `mutation.ts` — schema/root/threshold/status/location validation plus nonempty, exact-source mutation-report reconciliation (G30).
- `pins.ts` — exact dependency/runtime/Stryker pins plus parsed workflow/local-action YAML enforcement (G29).
- `production.ts` — OXC-decoded production/test separation, called-loader and dynamic-import bans, repository-local tsconfig inheritance/remapping enforcement, and shared AST barrel classification (G31).
- `comments.ts` — banned-string scan over `git ls-files` output (§7.13), concatenation-built patterns.
- `workspaces.ts` — fixes workspace topology to real directories under `packages/*`, requires TS-only non-test exports/import aliases under `src`, requires all four package scripts to match §5, and deliberately imports `core` through its JIT package export (G15/G25).
- `summary.ts` — CI summary writer (§9.1).
- Invoked by root turbo tasks through `bun -e` imports of the package's public source entry. Fully gated itself: 100% coverage, mutation, lint, types. Who gates the gates: the gates do.

## 12. Amendments to `extensible-ai-agent.md`

Applied together with this spec (agreed in grilling Q5):

1. §4.1 `EventEnvelope.payload: unknown` → `payload: Json` (validated by the registered Schema; `Json` from `@hena-dev/core`).
2. §5.1 `providerOptions: Record<string, unknown>` → `Record<string, Json>`; `inputJsonSchema: unknown` → `inputJsonSchema: Json`.
3. Decision log: new row **D25** referencing this spec; §15 gains a pointer to it; §14 package tree gains `ci-gates/`.

## 13. Scaffold verification results

1. **Passed**: bun workspaces initialized; dependencies installed with `bun i` from current compatible tags (Node types match the pinned Node 24 runtime), saved exactly; text `bun.lock` committed-ready.
2. **Passed**: native TS 7.0.2 accepts §6, emits both packages, and resolves JIT `.ts` exports under `nodenext`.
3. **Passed**: Effect `4.0.0-rc.112` + `@effect/vitest` rc typecheck and test under TS 7.
4. **Passed**: `oxlint-plugin-complexity` 2.1.8 loads in oxlint 1.80; combined rule is `complexity/complexity` with independent `cyclomatic`/`cognitive` caps.
5. **Passed by upstream contract**: setup-bun v2 reads `packageManager` by default; workflows use that behavior.
6. **Passed**: complete `bun run check:full` succeeds; 173 tests, 100% all four coverage dimensions in each package, every package production source present only in its owning coverage report with authentic counters, all 27 authored TS files present in metrics accounting, and mutation 100% (core 159 generated outcomes; ci-gates 2,002 generated outcomes, including 1,974 tested outcomes and 28 ignored mutants on six justified OXC discriminant guards). Reports are authentic and nonempty with exact roots/source snapshots/file sets and valid locations; there are zero survivors/no-coverage mutants, clones, dead code, banned type tokens, unjustified suppressions, static-scope/pin/production-scope violations, or lint/format/build/type errors. Current maxima: cognitive 18, cyclomatic/CRAP 19, Halstead difficulty 56.645.
7. **Verified cache**: warm `check:full` runs restore package test and mutation outputs before fresh successful static-scope and report reconciliation; package tasks use package-local default inputs plus shared TypeScript/Vitest global dependencies while excluding generated outputs. Git-discovery-dependent pin, production-scope, workspace, and report-reconciliation gates are uncached, preventing stale passes when discovered files, symlinks, workflows, manifests, or inherited configs change.
8. **Passed remote**: the public repository's `main` branch has strict required checks `checks` + `mutation`, enforced for administrators; force pushes and deletions are disabled. This PR supplies the workflows so both checks run before merge.

## 14. Risks

| Risk | Mitigation |
|---|---|
| TS 7 has no legacy JS compiler API; Stryker 10 imports it internally | Microsoft-sanctioned side-by-side install: native TS 7 supplies `tsc`; `@typescript/typescript6` supplies API consumers without downgrading builds; Bun's hoisted linker prevents platform-dependent bare-import resolution between the two packages |
| oxfmt 0.65 / oxlint pre-2.0 churn | Exact pins; oxfmt has zero config surface here; both replaceable line items (hena §17 already accepts this) |
| `oxlint-plugin-complexity` is third-party | Exact pin; fallback: own ~150-line oxlint JS plugin implementing Sonar cognitive complexity |
| Equivalent mutants wedging CI at score 100 | Justified `Stryker disable` regime with audit trail (G10) |
| Optional Stryker TS checker is disabled | The mandatory TS 7 typecheck remains a separate gate; invalid mutants die during Vitest transformation/runtime, while the TS 6 bridge lets Stryker perform its required config preprocessing |
| Vitest V8 silently omits an uncovered file it cannot remap | Post-test `coverage-files` reconciliation requires every package source path in `coverage-final.json`; omission is a hard failure (G27) |
| Static tools honor ignore files and generated-tree exclusions | Ignore behavior is explicit, and `static-scope` rejects committed TS in every intentionally excluded generated tree (G28) |
| Stryker accepts an empty mutation set as `NaN >= 100` | Barrels are mutated and `mutation-files` rejects every empty or malformed package report (G30) |
| Required workflow definitions remain commit-controlled | Protected `main` requires `checks` + `mutation`, administrator enforcement, and PR integration; stronger workflow immutability requires organization-level policy outside this repository |
| jscpd floor (70/8) mis-tuned for Effect boilerplate | Floor changes are spec amendments, not silent config drift |
| `{} \| null \| undefined` smuggling past the `unknown` ban | Named and accepted; review culture, not grammar |
| 100%-coverage + 0-survivor cost on future UI package (`web`) | Uniform policy stands (G3); if reality disagrees, that is a spec amendment discussed then, not an exemption slipped in |

## 15. Out of scope (deferred)

- knip production/strict mode (revisit when `testkit` lands — G11)
- Publishing flip (`exports` → `dist/`, npm publish pipeline) — hena D24 keeps the repo private until the extension API stabilizes
- Renovate/update automation (manual exact-pin upgrades for now — G14)
- CI fan-out per gate, merge queue, remote turbo cache service (revisit on wall-clock pain — G12)
- `as`-cast policy (not in the requested gate set; candidate for a future amendment)
