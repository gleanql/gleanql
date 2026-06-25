# Changelog

## 0.1.9 (2026-06-25)

### @gleanql/compiler, @gleanql/client, @gleanql/vite
- New: a server-side mutation primitive. `mutate((m, vars) => m.field(vars)..., vars)`
  is now a recognized selector callee (alongside the `useMutation`/`useSubscription`
  client hooks) — the compiler compiles its selector into a named mutation operation
  and the build transform injects the op name, exactly as for the hooks. The runtime
  is `integration.mutate(opName, vars)`: it resolves the compiled op, maps `vars` via
  the op's factory, runs it through the adapter, and surfaces `userErrors` — with NO
  preloaded read graph, so it works in server actions / webhooks / jobs (anywhere the
  adapter is request-authed). Frameworks expose it by forwarding to `integration.mutate`.
  Also exported `runServerMutation` (the cacheless executor) from `@gleanql/client`.

## 0.1.8 (2026-06-25)

### @gleanql/vite
- Fix: an `async` route component (e.g. `export default async function Page()`
  that `await`s alongside its `glean.*` reads) no longer breaks the RSC-hydrator
  auto-inject. The route transform dropped every leading modifier as one span
  when stripping `export`/`default` — and since `async` is also a modifier that
  follows them on a function declaration, it was stripped too, leaving `await`
  in a non-async function (`SyntaxError: Unexpected reserved word 'await'`). It
  now removes only the `export`/`default` keywords and preserves `async`.

## 0.1.6 (2026-06-15)

### @gleanql/vite
- Dev cache follow-ups: the codegen + incremental-program caches are now primed
  during the boot build, so the FIRST field edit after `dev` is fast (not just
  edits 2+); and the package skeleton (an esbuild bundle of the schema model) is
  skipped on a codegen cache-hit. Steady-state HMR recompile stays ~0.2s and the
  first edit now matches it.

## 0.1.5 (2026-06-14)

### @gleanql/vite, @gleanql/compiler
- Incremental dev cache — roughly 6x faster HMR recompiles. Two caches persist
  across a dev session: the SDL codegen (the schema is static, so introspection
  + model are reused) and the type engine's `ts.Program` via a new
  `BackendSession` (a SourceFile cache + `oldProgram` reuse, so a single-file
  edit re-checks only the edited route and its dependents instead of rebuilding
  the whole program, lib files and all). On the Shopify Admin schema a field
  edit drops from ~1.2s to ~0.2s. Dev-only — production builds stay clean and
  from scratch. Compiled output is identical.

## 0.1.4 (2026-06-14)

### @gleanql/vite
- New `clientFrom` plugin option: name a host package (a meta-framework) that
  transitively provides `@gleanql/client`, and the runtime is provisioned by
  resolving the client/core SOURCE through that host instead of from the app's
  manifest. Lets a framework re-export the `glean` accessor
  (`import { glean } from '@your-framework'`) so consuming apps declare zero
  `@gleanql/*` packages. Accessor discovery is unchanged — it keys off the
  `glean` identifier name, not the import specifier — so same-name re-exports
  compile with no other configuration.

## 0.1.3 (2026-06-13)

### @gleanql/vite
- Dev-time operation changes now hot-swap under the rwsdk preset — no more
  broken worker, no dev-server restart. Previously the watcher's
  `invalidateAll()` re-evaluated source modules against the digest-keyed
  prebundle (frozen per server lifetime), splitting the worker into mixed
  module generations ("graph not preloaded", "Request context not found",
  "Currently React only supports one RSC renderer"). Two new
  `FrameworkPreset` hooks: `operationsDigest` — when a regeneration leaves
  the digest unchanged the watcher does nothing at all (text-only edits keep
  plain HMR; no more full reload per save) — and `volatileModules` — when the
  digest changes, exactly these generated data modules are invalidated in
  every environment plus a browser reload. The volatile data
  (`@gleanql/client/operations` + the slim schema model it re-exports) is
  kept OUT of the prebundle via `optimizeDeps.exclude`, so frameworks must
  import it from a source (non-prebundled) module to see live data; the
  prebundled main entry and client glue keep harmless frozen copies (the
  accessor is request-graph-driven and hydration is snapshot-driven). With
  the preset's `hotUpdateEvent` (rwsdk: `"rsc:update"`) the swap converges
  IN PLACE — the client refetches the RSC payload and React reconciles, no
  page reload at all; the event is re-sent once after the compile window
  because the in-process compile blocks the event loop long enough for HMR
  sockets to drop and reconnect. Falls back to a full reload without the
  event, to a server restart on servers without per-module invalidation,
  and to the previous invalidate + full-reload for presets without the
  hooks.

## 0.1.2 (2026-06-11)

### @gleanql/vite
- Slim runtime schema: the generated `schema-model.js` now contains only the
  types/fields reachable from the compiled operations — identity keys, proxy
  navigation and `usePaginated` trails are all bounded by selections, so
  behavior is identical while large schemas stay out of the app bundle
  (Shopify Admin, ~3,000 types: ~1MB of schema source → a few KB; a real
  worker bundle measured 2.45MB → 0.85MB). The build still compiles routes
  against the full SDL in memory. There is no opt-out: reads outside the
  compiled selections were never part of the contract (`masking` exists to
  catch them), and `fetchMissing` continues to serve misses on selected
  fields.

### @gleanql/codegen
- Optional-args ergonomics: when every argument of a field (or query root) is
  optional, the generated signature takes an optional args object —
  `glean.productsCount()` and `image.url()` instead of demanding `({})`. This
  matches the runtime proxy, which already returns a callable for any field
  with declared arguments.

## 0.1.1 (2026-06-11)

- Releases now publish via npm trusted publishing (OIDC) with provenance
  attestations — no long-lived token in CI. No library changes.

## 0.1.0 (2026-06-11)

The first public cut of GleanQL — a TypeScript-native GraphQL query compiler:
plain components in, compiled/persisted operations + a normalized reactive
cache out. Highlights, by package:

### @gleanql/compiler
- Static analyzer: routes, prop flow (cross-file), helpers, islands,
  `.map`/`.filter`/`.find`/`.forEach` (inline, destructured incl. renames, and
  named function-reference callbacks), mid-chain + top-level list roots, union
  narrowing, component registries, `<GraphLazy>` boundaries.
- Hard invariant: unanalyzable reads are diagnostics (`strict` fails the
  build) — never a silent under-fetch.
- Two interchangeable type-checker engines: `typescript` (default) and the
  experimental Go-native `tsgo`; 36 golden fixtures run through both.

### @gleanql/client
- Suspense-aware runtime over a normalized cache (entity + path identity)
  with field-level reactivity and microtask-batched missing-field fetches.
- Reference-counted retention (mounted readers pin their records), LRU
  capacity cap, and staleness-aware `gc({ keepEpochs })` — opt-in via
  `gcKeepPages`, never collects what a back-navigation would want.
- Compile-time `useMutation` (optimistic fields + list membership with
  auto-rollback, `userErrors`), `useSubscription` (SSE in-box, `graphql-ws`
  adapter), `usePaginated`, component-sliced `refresh()`.
- `runOperation(name, variables)` for registered/named operations.
- `onEvent` incident channel (refresh/operation/mutation/subscription errors,
  persisted retries, gc) — baked option or runtime subscription.
- Persisted-operation transport (`persisted: true`, APQ wire shape) +
  `createPersistedResolver` server allowlist.
- Cycle-guarded normalization (clear error on cyclic optimistic data).
- Consumer test harness (`@gleanql/client/testing`): `createTestGraph` seeds a
  real runtime from plain JSON (typed reads + a production-path hydration
  payload for islands), `createMockAdapter` records operations with
  push-driven subscriptions, `mockGraphFetch` intercepts the endpoint by
  operation name.
- Islands server-render **warm** on both hosts: the page renders inside
  `<GraphHydrator>`, which carries this request's graph through React context
  in the SSR pass (request-isolated by construction) — no fallback flash, no
  server-prop passthrough, mismatch-free hydration by symmetry. Isomorphic
  hosts get the same via the active graph's own roots.

### @gleanql/core
- Operation IR, builder (`q.*` + the `buildQuery` fluent escape hatch),
  canonical merger (dedupe, identity injection, argument-conflict aliasing),
  deterministic printer with opt-in named-fragment extraction,
  dependency-free sha-256 `hashDocument` (the persisted-operation id).

### @gleanql/codegen
- SDL/introspection → `SchemaModel` + branded TS types + the typed `glean`
  accessor.

### @gleanql/vite
- The one-plugin build: provisions the runtime, runs codegen + the compiler,
  emits the generated accessor/operations/glue, the persisted manifest
  (`generated/persisted.json`), and the `/__glean` devtools overlay.
- Framework presets: RedwoodSDK (RSC) and React Router 7 (isomorphic SSR).
- Registered operations: `operations: "./src/report-operations.ts"` runs a
  `buildQuery` module at build time and allowlists its exports.
- Options: `endpoint`, `framework`, `backend`, `maxCacheRecords`, `strict`,
  `persisted`, `gcKeepPages`, `operations`.
- Per-preset dep-optimizer handling: rwsdk keys the prebundle cache on an
  operations digest (a stale prebundle served outdated operations across
  sessions); react-router excludes the generated package (esbuild cannot
  apply the app's `~/` alias inside it).
- Parse-gated emitters: every generated module's output runs through
  esbuild's parser in CI, across the full option matrix.

### Known limitations
- `@defer`/`@stream` deliberately deferred (graphql-js can't execute
  incremental delivery until v17); `<GraphLazy>` covers the use-case.
