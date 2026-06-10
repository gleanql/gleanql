---
title: Design decisions
group: Reference
order: 16
---

# Design decisions & deviations

Where an implementation choice was non-obvious, here's what was decided and why.

## Consistent `__typename` injection

Every non-root object selection gets `__typename`. Types exposing `id` also get `id`. The rule is uniform, with no exceptions for pure-scalar leaf objects like `MoneyV2`. As a result, existence checks and union discrimination always work, and generated documents stay predictable. The logic lives in `merger.ts`.

## `ttsc` backend = the `typescript` compiler API

The first backend uses a real `ts.Program` + `TypeChecker`. All type/symbol queries go through `GraphCompilerBackend`, so a Go-based engine (tsgo / `@typescript/native-preview` / Corsa) can replace it without touching analysis logic. `ts-morph` is intentionally not used. It is too slow and too far from the compiler path. The AST walking layer is the part a non-TS backend would re-target. Type info is fully behind the seam.

## `graphql` (graphql-js) is a test-only dependency

Tests use it as a *correctness oracle*: every generated operation is parsed and validated against an SDL form of the schema. It is not a runtime or transport dependency. The runtime owns cache identity and Suspense itself, with no second normalized cache underneath.

## Hybrid authority in v1

The compiler is authoritative for the initial operation. The runtime may fetch lazy/dynamic fields. v1 implements `hybrid` and exposes `unexpectedMissingField: "allow" | "warn" | "error"` to reach `strict` / `runtime-first` behavior.

## Mutations compile like reads — no schema convention in core

The client `useMutation` selector *defines* the operation. `(m, vars) => m.setProductTitle(vars).title` is rooted at the `Mutation` type and compiles to a `kind:"mutation"` op. The selector never runs at runtime. The build injects the compiled op name into the call site, exactly as `usePaginated` and `refresh()` have their target injected.

This mirrors the project's standing line: runtime primitives over compiler magic, with no Relay-style convention baked into the compiler/core.

The engine already existed for the server write side. `runMutation` handles normalization, optimistic writes, `userErrors`, and invalidation. This decision made mutations *compile* from a call-site selector and exposed a React hook (`[mutate, state]`) over the same engine.

## List-root membership is a runtime primitive, not a compiler convention

A list root's membership (`glean.todos()`) lives in the page pointer's `roots` array, not in a normalized record. Adding or removing an element is therefore not a field change the cache reconciles by identity.

The same "no convention in core" line applies. A Relay-style `@appendNode` directive would teach the compiler how a mutation mutates a list. Instead, membership is two plain runtime calls:

- `appendToRoot(field, entity, { prepend?, at? })`
- `removeFromRoot(field, entity)`

Both rewrite `roots[field]` and bump the page epoch. They splice in place, with no refetch. `appendToRoot` also seeds a client-built entity's fields, so a row renders before the server responds. Generating the id client-side makes the optimistic row the final one: the mutation normalizes over the same identity, so there is nothing to reconcile.

This is the membership counterpart to `useMutation`'s optimistic *field* writes. You call it where you know the intent, instead of the compiler guessing it from a directive.

## Fine-grained reactivity via version counters + an affected-key digest (valtio-style)

The cache avoids per-key subscription fan-out. Instead, it keeps **version counters**. Reads are tracked per component: each render's binding collects the keys it touched. The `useSyncExternalStore` tear-check compares a digest of just those keys' versions. A global `notify()` therefore re-renders only the components whose keys actually changed.

Tracking is **field-level**. A read records the exact `record + field`, so two components reading different fields of the *same* entity don't wake each other. The cache keeps versions at two granularities:

- per-field versions, which `useGlean` tracks;
- per-record versions, which `usePaginated` tracks to watch a whole connection record.

A write bumps both the field and the record. `trackedVersion` resolves each tracked key at its own granularity.

**Implementation subtlety:** the external snapshot is a monotonic counter gated inside the subscriber, *not* the raw digest returned from `getSnapshot`. Returning the digest loops. Reads happen *after* the hook runs, so the render-time snapshot is empty and the post-commit tear-check always diverges. Instead, the subscriber recomputes the digest on each notify and bumps the counter only when it changed. An effect then rebases the baseline to this render's reads.

Attribution is **per binding**. `useGlean` binds the graph with its render's own `affected` set, so reads through that render's proxies record into it directly. That makes attribution fiber-local and safe under concurrent or interrupted rendering. A module-global tracker survives only as a fallback for trackerless proxies — the server / isomorphic accessor — where no re-render depends on attribution.

## Subscriptions compile like mutations; transport stays behind the adapter

A `useSubscription((s, vars) => s.productChanged(vars).price)` selector compiles exactly like a mutation. It is rooted at the `Subscription` type, and the build injects the op name. The discovery, binding and analyzer paths are therefore *shared*: one selector-hook code path, not two.

The runtime hook drives the adapter's `subscribe` async-iterable and folds each pushed result into the normalized cache. Fine-grained reactivity then re-renders only the readers of a changed record.

**Transport is the adapter's job, not the runtime's.** The in-box fetch adapter implements `subscribe` over Server-Sent Events (`EventSource`). That needs no extra client library and streams fine for the example. A production app that prefers WebSockets passes a `graphql-ws` client to the built-in `createGraphWsAdapter`. The seam is the same, so no compile or hook changes are needed. graphql-ws carries every operation kind, so that one adapter drives both `execute` and `subscribe`.

## Deliberately deferred

- **Lazy component *data*** — the `<GraphLazy>` *boundary* is wired: excluded fields fall through to runtime fetches. Per-view lazy manifests are not.
- **Imported-helper body analysis — now SHIPPED.** A graph value passed to an imported function (`formatPrice(product.priceRange.minVariantPrice)`) resolves through the type-checker. The helper's body is walked, and its reads fold into the operation attributed to the helper's name. The same applies to function references in `.map(renderRow)`. Unanalyzable callbacks fail the build with `unsupported-list-flow` rather than under-fetching.
- **Subscription auth / resume policy** — the `graphql-ws` transport ships, but reconnect/resume semantics and per-subscription auth are left to the app's client config.

## Shipped since the first cut

The following all shipped after the first cut — see the entries above:

- mutations: server `runMutation` plus the compile-time `useMutation` hook;
- subscriptions: `useSubscription` over SSE *and* the built-in `graphql-ws` transport;
- top-level list roots (`glean.todos()`);
- fiber-scoped read attribution;
- the RedwoodSDK and React Router adapters;
- connection pagination (`usePaginated`);
- fine-grained reactivity;
- persisted operations: sha-256 manifest, `persisted: true` wire mode, and the `createPersistedResolver` allowlist — live in `examples/rwsdk-real`;
- reference-counted store retention: mounted readers pin what they read, and `cache.gc()` sweeps the rest.

## `@defer` / `@stream`: a decision, not (yet) a feature

Incremental delivery is deliberately **not** implemented, for two reasons.

**The use-case is already covered, differently.** Apps reach for `@defer` to render the page now and fill an expensive subtree later. That is what `<GraphLazy>` does: reads inside the boundary are *excluded* from the route operation and fetched on demand at runtime. The UX is the same — fast first paint, late subtree. The mechanics differ: two ordinary requests instead of one chunked response. RSC hosts add a second layer for free: Suspense streaming defers *rendering* server-side without GraphQL's involvement.

**Implementing it today would ship dead code.** Real `@defer` needs three things:

- an incremental-delivery transport, meaning `multipart/mixed` chunk parsing in the adapter;
- patch-application semantics in the cache, applying `incremental` payloads at their `path`;
- decisively, a server that can produce it.

graphql-js only executes incremental delivery in the v17 alphas, and every example server here runs v16. There is nothing to verify end-to-end against. Unverifiable runtime code is how silent bugs ship.

The pieces are staged for when the ecosystem lands:

- Directives already exist in the IR and print correctly.
- The compiler could mark a `<GraphLazy>` boundary as `... @defer` instead of excluding it (one analyzer switch).
- The cache's normalization already applies partial results.

When graphql-js 17 stabilizes, the work is the adapter's chunk parser plus an integration test — not a redesign.

## Testing strategy

The test suite has three layers:

- **Core unit tests** cover the merger, printer, builder, devtools, and fluent escape hatch.
- **Golden fixtures** map `input.tsx` to `expected.graphql` / `expected.variables.ts` / `expected.readmap.json` / `expected.diagnostics.json`. Each generated op is validated with graphql-js.
- **Runtime tests** cover Suspense, batching, identity, seeding, hydration, invalidation, mutations, and reactivity.

There are 350+ tests total. The whole workspace type-checks against one root `tsconfig.json`. GitHub Actions (`.github/workflows/ci.yml`) runs `pnpm typecheck` + `pnpm test` on every push to `main` and every PR. Packages resolve to source (`exports` → `./src`), so the suite needs no build step.

---

See the [golden cases](golden-cases.md) for the behavior catalog.
