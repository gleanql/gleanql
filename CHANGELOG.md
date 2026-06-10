# Changelog

## 0.1.0 (unreleased)

The first public cut of Glean — a TypeScript-native GraphQL query compiler:
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

### Known limitations
- `@defer`/`@stream` deliberately deferred (graphql-js can't execute
  incremental delivery until v17); `<GraphLazy>` covers the use-case.
