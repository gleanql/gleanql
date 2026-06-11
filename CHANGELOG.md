# Changelog

## Unreleased

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
