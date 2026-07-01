# Changelog

## 0.1.18

### @gleanql/compiler
Diagnostic: `unawaited-deferred-read`. A deferred ("two-sweep") root read that is
consumed SYNCHRONOUSLY inside an `async` component (`const x = glean.nodes({ ids });
x.forEach(…)`) is now a build-time error. Read synchronously it throws a Suspense
promise, and thrown from inside an `async` component that re-invokes it, it loops
until the CPU budget is exhausted (a blank page / "exceeded CPU time" in
production). The fix is to `await` the read. The compiler only flags the `async`
case — a synchronous read in a non-`async` component is fine (a Suspense boundary
catches the throw) — and never flags an `await`ed read (it sees through the `await`).
`@gleanql/vite` re-bundles the compiler, so a Vite build surfaces it. See
`docs/compiler.md`.

## 0.1.17

### @gleanql/vite
Provision the runtime from the PRISTINE installed source, not the self-provisioned
shadow. The plugin writes a per-app `@gleanql/client` (transpiled `.js` + generated
accessor) into `node_modules/@gleanql/client`; on later builds, app-level resolution
of `@gleanql/client` lands on that shadow (no `.ts`), and `resolveRuntimeSources`
fell back to the newest version-keyed stash — so an **in-place `@gleanql/client`
upgrade shipped the OLD runtime** while the compiler emitted new (e.g. `deferred`)
operations. That mismatch eager-preloaded a deferred op with an unbound `$var` →
runtime error. Now it skips any root without `.ts` sources (the shadow) and resolves
the real upgraded copy through the host (`clientFrom`) package, re-stashing under the
new version. Fixes silent stale-runtime after `pnpm update @gleanql/*`.

### docs
The two-sweep example now `await`s the deferred read (`await glean.nodes({ ids })`)
and documents the rule: in an `async` component (or any non-React handler) you must
`await` a deferred root — a synchronous Suspense read thrown from inside an `async`
component re-invokes it and loops until the CPU budget is exhausted (blank page in
production). The synchronous form is only for non-`async` components. See
`docs/compiler.md`.

## 0.1.16

### @gleanql/compiler
Trace field reads on an `await`ed root binding. `const o = await glean.order({ id });
o.name…` now compiles the same operation as the un-awaited `const o =
glean.order({ id })` — the analyzer sees through the `await` (as it already does for
`(expr)` and `expr!`), so the reads on `o` register instead of silently
under-fetching to `order { __typename id }`. This is the compiler half of the
isomorphic accessor: 0.1.15 made the runtime resolve `await glean.x()` in a
non-React handler (webhook / job / proxy / API route), but the compiler wasn't
following the reads on the resolved value, so real handlers under-fetched. Reads
still have to be reachable from where the root is read — inline the `glean.x()` call
in the handler (a call-site argument makes it deferred) and pass the resolved graph
*value* to any reshaping helper, not an id. `@gleanql/vite` re-bundles the compiler,
so a Vite build picks the fix up. See `docs/compiler.md`.

## 0.1.15

### @gleanql/client
`await glean.x({…})` in non-React server handlers. A deferred ("two-sweep") root
read is now **isomorphic**: the same call site suspends in a React render *and*
resolves when `await`ed in a plain handler (webhook, job, proxy, API route), so
those handlers fetch through the compiler instead of a raw `graphql()` string. The
bound graph returns a deferred root as a value that is both directly readable
(Suspense) and awaitable; `runtime.resolveRootAsync` is the async twin of
`resolveRoot`, sharing the request cache and in-flight map so an `await` and a
concurrent render read of the same root+args dedupe to one fetch. A graph proxy now
reports no `then`, so awaiting an already-seeded root (or returning a graph value
from an `async` handler) is a safe pass-through rather than a `.then` probe that
suspends. A failed `await` rejects cleanly — the internal dedup barrier no longer
leaks an unhandled rejection. See `docs/runtime.md` and `docs/compiler.md`.

### @gleanql/codegen
Interfaces render as the **union of their implementers** (`type Node = Product |
Collection`) instead of a thin `interface Node { __typename; id }`. Common fields
stay accessible across the union and a `__typename` guard narrows to the concrete
type — the shape a selection on an interface root actually returns, which makes
`await glean.node({ id })` narrowable in a handler. See `docs/codegen.md`.

## 0.1.14

### @gleanql/compiler, @gleanql/client, @gleanql/vite, @gleanql/core
Render-time ("two-sweep") root arguments. A glean root read whose argument is
computed *during* render — e.g. `glean.nodes({ ids: services.map(s => s.productId) })`
after an `await` — is no longer forced through the `getXVariables(ctx)` preload
factory (which produced invalid JS / referenced out-of-scope locals). The
compiler now keeps the `$var` in the document, marks the operation `deferred`,
and omits the var from the factory; the runtime executes that root at the read
call-site with the supplied args (`runtime.resolveRoot` + `resolveDeferredRoot`,
reusing the pagination runtime-variable machinery) and seeds the cache. `ctx`
becomes one variable source (known before render) alongside the render scope
(known during it). `__typename` narrowing is unaffected. Server/RSC integration
wired; the underlying primitives are general. See `docs/compiler.md`.

## 0.1.10 (2026-06-25)

### @gleanql/vite, @gleanql/compiler
- The server mutation primitive's callee name is now **configurable** via the new
  `serverMutate` plugin option (e.g. `glean({ serverMutate: 'mutate' })`) instead of
  Glean hardcoding the name `mutate`. When set, that callee compiles its selector to
  a mutation operation and the binding transform injects the op name — across the
  analyzer, the binding, AND file discovery (a file whose only graph usage is a
  server-mutate call is now discovered and compiled). Unset ⇒ Glean claims no extra
  name. `selectorHooks(serverMutate?)` is the single source of truth shared by all
  three. (`integration.mutate` + `runServerMutation` from 0.1.9 are unchanged.)

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
