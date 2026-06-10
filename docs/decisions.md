---
title: Design decisions
group: Reference
order: 16
---

# Design decisions & deviations

Where an implementation choice was non-obvious, here's what was decided and why.

## Consistent `__typename` injection

Every non-root object selection gets `__typename`; types exposing `id` also get `id`. One uniform rule, no exceptions for pure-scalar leaf objects like `MoneyV2` — existence checks and union discrimination always work, and generated documents stay predictable. Lives in `merger.ts`.

## `ttsc` backend = the `typescript` compiler API

The first backend uses a real `ts.Program` + `TypeChecker`. All type/symbol queries go through `GraphCompilerBackend`, so a Go-based engine (tsgo / `@typescript/native-preview` / Corsa) can replace it without touching analysis logic. `ts-morph` is intentionally not used (too slow, too far from the compiler path). The AST walking layer is the part a non-TS backend would re-target; type info is fully behind the seam.

## `graphql` (graphql-js) is a test-only dependency

It is used in tests as a *correctness oracle*: every generated operation is parsed and validated against an SDL form of the schema. It is not a runtime or transport dependency — the runtime owns cache identity and Suspense itself, with no second normalized cache underneath.

## Hybrid authority in v1

The compiler is authoritative for the initial operation; the runtime may fetch lazy/dynamic fields. v1 implements `hybrid` and exposes `unexpectedMissingField: "allow" | "warn" | "error"` to reach `strict` / `runtime-first` behavior.

## Mutations compile like reads — no schema convention in core

The client `useMutation` selector *defines* the operation: `(m, vars) => m.setProductTitle(vars).title` is rooted at the `Mutation` type and compiles to a `kind:"mutation"` op. The selector never runs at runtime — the build injects the compiled op name into the call site, exactly as `usePaginated` and `refresh()` have their target injected. This mirrors the project's standing line: runtime primitives over compiler magic, no Relay-style convention baked into the compiler/core. The engine (`runMutation` — normalize + optimistic + `userErrors` + invalidate) already existed for the server write side; this made mutations *compile* from a call-site selector and exposed a React hook (`[mutate, state]`) over the same engine.

## List-root membership is a runtime primitive, not a compiler convention

A list root's membership (`glean.todos()`) lives in the page pointer's `roots` array, not in a normalized record — so adding/removing an element isn't a field change the cache reconciles by identity. The same "no convention in core" line applies: rather than a Relay-style `@appendNode` directive that teaches the compiler how a mutation mutates a list, membership is two plain runtime calls — `appendToRoot(field, entity, { prepend?, at? })` / `removeFromRoot(field, entity)` — that rewrite `roots[field]` and bump the page epoch. They splice in place (no refetch), and `appendToRoot` seeds a client-built entity's fields so a row renders before the server responds. Generating the id client-side makes the optimistic row the final one (the mutation normalizes over the same identity, nothing to reconcile). It's the membership counterpart to `useMutation`'s optimistic *field* writes — you call it where you know the intent, instead of the compiler guessing it from a directive.

## Fine-grained reactivity via version counters + an affected-key digest (valtio-style)

Rather than per-key subscription fan-out, the cache keeps **version counters**, reads are tracked per component (each render's binding collects the keys it touched), and the `useSyncExternalStore` tear-check compares a *digest of just those keys' versions* — so a global `notify()` re-renders only the components whose keys actually changed. Tracking is **field-level**: a read records the exact `record + field`, so two components reading different fields of the *same* entity don't wake each other. The cache keeps both per-field versions (for `useGlean`) and per-record versions (`usePaginated` watches a whole connection record); a write bumps the field *and* the record, and `trackedVersion` resolves each tracked key at its own granularity. **Implementation subtlety:** the external snapshot is a monotonic counter gated inside the subscriber, *not* the raw digest returned from `getSnapshot`. Returning the digest loops: reads happen *after* the hook runs, so the render-time snapshot is empty and the post-commit tear-check always diverges. The subscriber recomputes the digest on each notify, bumps the counter only when it changed, and an effect rebases the baseline to this render's reads. Attribution is **per binding**: `useGlean` binds the graph with its render's own `affected` set, so reads through that render's proxies record into it directly — fiber-local, safe under concurrent/interrupted rendering. (A module-global tracker survives only as a fallback for trackerless proxies — the server / isomorphic accessor — where no re-render depends on attribution.)

## Subscriptions compile like mutations; transport stays behind the adapter

A `useSubscription((s, vars) => s.productChanged(vars).price)` selector compiles exactly like a mutation — rooted at the `Subscription` type, the build injects the op name — so the discovery, binding and analyzer paths are *shared* (one selector-hook code path, not two). The runtime hook drives the adapter's `subscribe` async-iterable and folds each pushed result into the normalized cache, so fine-grained reactivity re-renders only the readers of a changed record. **Transport is the adapter's job, not the runtime's:** the in-box fetch adapter implements `subscribe` over Server-Sent Events (`EventSource`), which needs no extra client library and streams fine for the example; a production app that prefers WebSockets passes a `graphql-ws` client to the built-in `createGraphWsAdapter` — same seam, no compile or hook changes. (graphql-ws carries every operation kind, so that one adapter drives both `execute` and `subscribe`.)

## Deliberately deferred

- **Lazy component *data*** — the `<GraphLazy>` *boundary* is wired (excluded fields fall through to runtime fetches); per-view lazy manifests are not.
- **Imported-helper body analysis — now SHIPPED.** A graph value passed to an imported function (`formatPrice(product.priceRange.minVariantPrice)`) resolves through the type-checker, its body is walked, and its reads fold into the operation attributed to the helper's name — same for function references in `.map(renderRow)`. Unanalyzable callbacks fail the build with `unsupported-list-flow` rather than under-fetching.
- **Subscription auth / resume policy** — the `graphql-ws` transport ships, but reconnect/resume semantics and per-subscription auth are left to the app's client config.

> [!NOTE]
> Shipped since the first cut: mutations (server `runMutation` + the compile-time `useMutation` hook), subscriptions (`useSubscription` over SSE *and* the built-in `graphql-ws` transport), top-level list roots (`glean.todos()`), fiber-scoped read attribution, the RedwoodSDK and React Router adapters, connection pagination (`usePaginated`), fine-grained reactivity, persisted operations (sha-256 manifest + `persisted: true` wire mode + `createPersistedResolver` allowlist — live in `examples/rwsdk-real`), and reference-counted store retention (mounted readers pin what they read; `cache.gc()` sweeps the rest) all shipped — see the entries above.

## `@defer` / `@stream`: a decision, not (yet) a feature

Incremental delivery is deliberately **not** implemented, for two reasons.

**The use-case is already covered, differently.** What apps reach for `@defer` for — "render the page now, fill this expensive subtree later" — is what `<GraphLazy>` does: reads inside the boundary are *excluded* from the route operation and fetched on demand at runtime. Same UX (fast first paint, late subtree), different mechanics (two ordinary requests instead of one chunked response). RSC hosts add a second layer for free: Suspense streaming defers *rendering* server-side without GraphQL's involvement.

**Implementing it today would ship dead code.** Real `@defer` needs an incremental-delivery transport (`multipart/mixed` chunk parsing in the adapter), patch-application semantics in the cache (apply `incremental` payloads at their `path`), and — decisively — a server that can produce it: graphql-js only executes incremental delivery in the v17 alphas, and every example server here runs v16. There is nothing to verify end-to-end against, and unverifiable runtime code is how silent bugs ship.

The pieces are staged for when the ecosystem lands: directives already exist in the IR and print correctly, the compiler could mark a `<GraphLazy>` boundary as `... @defer` instead of excluding it (one analyzer switch), and the cache's normalization already applies partial results. When graphql-js 17 stabilizes, the work is the adapter's chunk parser plus an integration test — not a redesign.

## Testing strategy

Three layers: **core unit tests** (merger/printer/builder/devtools/fluent), **golden fixtures** (`input.tsx` → `expected.graphql` / `expected.variables.ts` / `expected.readmap.json` / `expected.diagnostics.json`, each generated op validated with graphql-js), and **runtime tests** (Suspense, batching, identity, seeding, hydration, invalidation, mutations, reactivity). 350+ tests total; the whole workspace type-checks against one root `tsconfig.json`. GitHub Actions (`.github/workflows/ci.yml`) runs `pnpm typecheck` + `pnpm test` on every push to `main` and every PR — packages resolve to source (`exports` → `./src`), so the suite needs no build step.

---

See the [golden cases](golden-cases.md) for the behavior catalog.
