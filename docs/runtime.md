---
title: @gleanql/client
group: Internals
order: 8
---

# `@gleanql/client` runtime

A Suspense-aware runtime that owns cache identity and read behavior. Transport is delegated to a client adapter, so the runtime never overlaps a normalized client cache.

> [!NOTE]
> **Dependencies.** Runtime dep on `@gleanql/core` only. Because the package now ships React hooks (`useGlean`) + the hydrator components in source (`glue-client.ts` / `glue-server.ts`), `react` is a **peer dependency** (`>=18`).

## Client adapter (the only transport seam)

The runtime owns the graph — cache, normalization, reactivity; an adapter owns the wire. The interface is two methods, so the transport is pluggable: a plain fetch adapter ships in-box (its `subscribe` streams over Server-Sent Events by default), a built-in `createGraphWsAdapter` carries everything over a `graphql-ws` WebSocket, and an app already running urql/Apollo can wrap it here. We do *not* use a client's normalized cache (it would duplicate ours) — the adapter is pure transport.

```tsx
interface GraphClientAdapter {
  execute<TData, TVariables>(operation, variables, context): Promise<GraphResult<TData>>;
  subscribe?<…>(…): AsyncIterable<GraphResult<TData>>;   // SSE by default; or graphql-ws
}

const adapter = createFetchAdapter({ endpoint, headers?(context), fetch?, subscriptionEndpoint? });

// WebSocket transport — one graphql-ws client drives execute + subscribe.
// @gleanql/client does not bundle graphql-ws; the app installs it and passes the client.
import { createClient } from "graphql-ws";
const wsAdapter = createGraphWsAdapter({ client: createClient({ url: "wss://…/graphql" }), extensions?(context) });
```

Request *context* (auth token, shop domain, locale, env) is used only to build headers (fetch) or per-operation `extensions` (graphql-ws) — it is never serialized into the request body or to the client.

> [!NOTE]
> **Persisted operations.** `createFetchAdapter({ persisted: true })` sends every compiled operation **by its sha-256 hash** (`extensions.persistedQuery.sha256Hash` — the APQ wire shape), never by document, and retries once with the document if the server answers `PersistedQueryNotFound`. The server side is one helper: `createPersistedResolver(operations)` maps an incoming body to an allowlisted document (`ok` / `not-found` / `rejected`; `allowUnpersisted` opts out of rejection). The build owns both ends, so the allowlist is free — enable it with [`persisted: true` on the plugin](vite.md).

## Cache identity model

Two storage identities:

| Identity | Key | When |
| --- | --- | --- |
| Normalized entity | `__typename + id` | type exposes an `id` |
| Path identity | `root + args + path` | object without `id` |
| Scalar | stored inline | leaf values |

Two query paths returning the same `__typename + id` resolve to *one* record, so an update through any path is visible through all of them.

```tsx
cache.recordKey(ref)            // entity identity wins over path
cache.getField(ref, fieldKey)   // → { status: "ready", value } | { status: "missing" }
cache.merge(ref, fields)
cache.invalidate(ref) · cache.invalidateField(ref, key)
cache.recordVersion(key)     // per-record counter, bumped on each write (fine-grained reactivity)
cache.snapshot() · GraphCache.fromSnapshot(snap)
```

## Suspense-aware reads

A read is synchronous on a hit. On a miss it enqueues the missing `(ref, field)`, creates exactly one cached promise, and throws it (the Suspense contract). Re-reading a pending field throws the *same* promise — no duplicate request, stable across React render retries.

```tsx
function readField(ref, fieldKey) {
  const got = cache.getField(ref, fieldKey);
  if (got.status === "ready") return got.value;   // sync hit
  const existing = pending.get(key);
  if (existing) throw existing.promise;          // reuse — no new request
  // otherwise: enqueue, schedule a microtask flush, throw a fresh promise
}
```

## Reactivity & cache-first refetch

The cache carries a global `version` + `subscribe(listener)`, bumped on every write — the `useSyncExternalStore` contract and the one notify channel. A naive subscriber on that version is *coarse*: any write re-renders every graph component. So the cache *also* keeps per-record version counters (`recordVersion(key)`), bumped on each write alongside the global one, and `useGlean` gates its snapshot on just the records the component read (valtio's model).

**Fine-grained reactivity.** A graph proxy read records which record it touched into its binding's read tracker (`GraphBinding.tracker` in `proxy.ts`). `useGlean` binds the graph with a fresh per-render set; the reads in that render populate it. Its `useSyncExternalStore` subscriber recomputes a digest of *just those records'* versions on each notify (`affectedDigest`) and re-renders only when the digest changed — so a global notify skips components whose keys are untouched. A component re-renders only when a field it read actually changed.

```tsx
function affectedDigest(cache, keys) {     // keys = what this render read (fields, or whole records)
  let out = "";
  for (const key of keys) out += `${key}:${cache.trackedVersion(key)}|`;
  return out;                            // changes iff a tracked key's version bumped
}
```

Tracking is **field-level**: a read records the exact `record + field` it touched, so two components reading different fields of the *same* entity (one reads `product.title`, another `product.views`) don't wake each other. The cache keeps both per-field versions (for `useGlean`) and per-record versions (`usePaginated` tracks its connection's whole record, re-rendering when a page lands); `trackedVersion` resolves a tracked key at its own granularity. Attribution is **per binding**: `useGlean` binds the graph with this render's own `affected` set, so reads through its proxies record into it directly — fiber-local, so interleaved concurrent renders can't cross-attribute (a module-global tracker stays only as a fallback for the trackerless server / isomorphic accessor). SSR is a no-op. `useMutation` needs no cache subscription — its state drives loading/data, and a displayed entity reacts through `useGlean`. Beyond the per-key digest, `useGlean` also re-renders on a **page-pointer change** (hydration or client navigation): root resolution changes for every reader then, so an island that first rendered before hydration re-resolves its roots and re-tracks the right keys, rather than staying bound to a stale pre-hydration path ref.

`runRoute` is *cache-first*: it persists each root call's link (`product(handle:"x") → Product:123`) and, on a re-run, serves from the cache when the full selection is already present — skipping the network. `refetch()` bypasses that to force a fresh fetch; the re-seed bumps the version and only the components whose records changed update.

## Store retention & GC (reference-counted, Relay-style)

The same read-tracking that drives fine-grained re-rendering also drives **retention**: post-commit, a tracking hook (`useGlean` / `usePaginated`) *retains* the records this render read — a reference count on each record — re-diffs the set every render, and releases on unmount. Retained records are privileged twice:

- **LRU eviction skips them.** With a `maxCacheRecords` cap, the eviction victim is the coldest *unretained* record — what's on screen is never evicted, even if it's the oldest.
- **`cache.gc()` sweeps only the unretained.** Version counters survive collection, so a refetched record stays monotonic for its trackers.

But "unretained" alone is *not* a reason to drop data — a back-navigation should hit a warm cache. So automatic collection is staleness-aware and opt-in: the cache carries a generation clock (`advanceEpoch()`, advanced per navigation; every read/write/retain re-stamps a record), and `gc({ keepEpochs: N })` drops only records that are unretained *and* untouched for N generations. The plugin's [`gcKeepPages`](vite.md) option wires this to navigations; bare `gc()` remains the full reset (logout). `maxCacheRecords` (LRU) bounds capacity; this bounds staleness.

```tsx
cache.retain(key)      // pin a record; returns the matching release (idempotent)
cache.isRetained(key)
cache.gc()              // drop every unretained record; returns how many

// The hooks do this automatically — manual retain() is only for non-React readers.
```

## Error surfaces

One channel per surface: a failed `fetchMissing` *rejects* the suspended read's promise (the React error-boundary contract — pair every route/island with a boundary); `unexpectedMissingField: "error"` throws synchronously on reads the compiler should have covered. `runRoute` returns `errors` beside `roots` (the preload 404 branch). Mutations never throw on logical failures — `MutationResult` carries `error` (transport/GraphQL) and `userErrors` (your schema's), and optimistic writes roll back on either. The fetch adapter turns non-JSON responses into a clear transport error; GraphQL `errors` always ride the result object.

**Central observability:** `createGraphClient({ onEvent })` mirrors every runtime incident to one channel — `refresh-error`, `mutation-error` (transport/GraphQL only; `userErrors` are expected outcomes and not reported), `subscription-error`, `persisted-retry` (the server didn't know a hash), and `gc` (something was collected on navigation). Wire it to Sentry & friends; a throwing listener is swallowed — observability must never break the app. Cyclic optimistic data fails normalization with a clear `circular reference` error instead of a stack overflow.

## Missing-field batching

Multiple misses in the same tick batch into a single `fetchMissing` call (one patch operation). One render pass produces at most one patch request, no matter how many fields it missed.

```tsx
new GraphRuntime({
  fetchMissing: (misses) => Promise<MissingFieldResult[]>, // the seam to your transport
  cache?,
  unexpectedMissingField?: "allow" | "warn" | "error", // hybrid / strict
  schedule?, onWarn?,
})
```

## Seeding & result normalization

Because every object selection includes `__typename` (and `id` when available), a GraphQL JSON result carries enough information to normalize itself into the cache — no selection needed:

```tsx
runtime.seedResult(data) // returns each root field's ref for reading

// __typename + id → entity record;  otherwise → path record;
// scalars inline; object fields store a ref; lists store arrays of refs/scalars
```

## Runtime graph proxies

The compiler infers *what* to fetch; the proxies make ordinary reads actually *execute*. A graph value is a Proxy over a cache ref. Property access routes through the Suspense-aware runtime — a scalar reads through, an object field re-wraps as a child proxy, a list maps to child proxies, a field with arguments becomes a callable. Nothing in userland sees a ref, a selection, or a promise.

```tsx
const graph = bindGraph({ schema, getRuntime, roots }); // roots from runRoute()
const product = graph.product({ handle });            // proxy over the seeded ref
product.title                         // scalar → cache read (sync hit / throws promise)
product.featuredImage?.url            // object → child proxy; null short-circuits
collection.products({ first: 12 }).nodes  // callable + list → array of proxies
product.selection                     // escape hatch: { ref, type }
```

A lone callable field reads by its plain name; argument-conflicting variants the compiler aliased (`url_transformMaxWidth300`) are resolved by their argument-derived key — the proxy tries the most-specific key first, then the plain name, so it is correct without knowing about conflicts.

## Request scope

A module-level `import { glean } from "@gleanql/client"` must resolve to *the runtime for the current request* on the server (concurrent requests must not share a cache) and a singleton in the browser. `GraphScope` is that seam — back it with `AsyncLocalStorage` for automatic per-request isolation, or resolve from the framework's own request context.

```tsx
scope.run(active, fn)  // server: install the request runtime for this render
scope.current()        // what `glean` resolves to (throws outside any scope)
scope.set(active)      // client: install the singleton after hydration
```

## The route flow (framework seam)

A compiled operation + a client adapter + a request context is enough to drive a route. A framework adapter (RWSDK first) answers "which operation for this entrypoint?" and "how do I build the request context?".

```tsx
await runRoute({ operation, routeContext, adapter, context, runtime });
// 1 compute variables  2 execute  3 seed cache  → { variables, roots, errors }
```

The preferred end-to-end flow: adapter identifies the entrypoint → load the generated operation → compute variables from params/search/context → fetch → seed the cache → components render and read synchronously → missing/lazy fields suspend.

## Hydration — two models

There are two ways the server cache reaches the client, picked by the host.

**SSR `<script>` (non-RSC hosts).** Server renders against a server-side cache; serialize `runtime.snapshot()` + root handles; the client recreates the cache with `GraphRuntime.hydrate(snapshot, options)` and can still Suspense-fetch missing fields through its adapter. The payload is published once on `window` and read once — simple and synchronous.

**RSC flight (React Server Components).** Under RSC the `Document` shell renders once but each client navigation re-streams *only the page subtree*, so a one-shot global goes stale on navigation. Instead the snapshot rides the RSC flight stream as a *client-component prop* (it is plain JSON by construction), and on every (re)render that component folds it into a single **long-lived** client runtime — the cache *accumulates* across navigations rather than being rebuilt. The primitives:

```tsx
runtime.absorbRecords(snapshot)     // fold a snapshot, write-only (no notify); → changed?
runtime.notify()                    // bump version + run listeners (after absorbRecords)
runtime.absorb(snapshot)            // absorbRecords + notify, in one call

absorbHydrationPayload(runtime, payload)  // render-phase merge (write-only); idempotent
pagePointer(payload)                      // → GraphPagePointer: operation + vars for refresh()
```

Both models are driven by one typed factory, `createGraphClient` (`src/glue-client.ts`): omit a scope for the RSC private singleton (fed by `<GraphHydrator>`), or pass the app's shared scope for isomorphic SSR (the host calls `hydrate(payload)`). Its server counterpart, `createGraphServer` (`src/glue-server.ts`), produces `GraphHydrate` / `withGraphHydration`. The generated `@gleanql/client/client` and `@gleanql/client/server` entrypoints are thin shims over these factories (re-exporting `useGlean` / `refresh` / `hydrate` / `GraphHydrator` and `GraphHydrate` / `withGraphHydration`) — the typed logic lives in source, not template strings. See [@gleanql/vite](vite.md).

`absorbHydrationPayload` is a render-phase merge — write-only, no subscriber notify (the caller bumps in a commit-phase effect) — so it is safe to call during render and idempotent across React retries. `pagePointer` derives the current operation + variables a client island uses to `refresh()`. Because the runtime is long-lived, `bindGraph`'s `roots` can be a getter, resolved per call, so the bound graph follows the page-current roots across navigations.

## Client-side `refresh()`

`refresh(operationName?)` re-runs the **entire** compiled operation for the current page (or the named one) over the wire — bypassing cache-first (`refetch` in `route.ts` calls `runRoute` with `cacheFirst: false`) — and re-seeds the cache. The network request fetches the *whole* operation, not a field-level slice. The normalized cache then reconciles by entity identity (`__typename + id`), so only fields that actually changed re-render, but the over-the-wire payload is the full operation. To refetch a smaller slice today, pass a smaller operation name. The current page's operation + variables come from `pagePointer`; the re-seed bumps the cache version, so subscribers (`useGlean`) re-render.

## List-root membership (`appendToRoot` / `removeFromRoot`)

A **list root** (`type Query { todos: [Todo!] }`, read as `glean.todos()`) keeps its membership in the page pointer's `roots` array — *not* in any normalized record. A field change to an element (a toggle) reconciles by identity for free, but **adding or removing an element changes the root array**, which a reader only sees by re-resolving roots. So instead of `refresh()`-ing the whole list after every add/remove, splice membership in place:

```tsx
appendToRoot("todos", entity, { prepend?, at? }) // add — dedupes; { at } inserts at an index
removeFromRoot("todos", entity)              // remove — entity, { __typename, id }, or a ref
```

Each resolves the entity's ref, rewrites `currentPage.roots[field]`, and bumps the page epoch so root readers re-resolve + re-render. No network round-trip. (For an *object* root the ref is stable, so these are a no-op there — its field-version bump already drives the update.)

**Optimistic UI.** Pass a client-built entity with its fields and `appendToRoot` also *seeds* them (id included) into the cache, so the row renders *before* the server responds. Generate the id client-side so the optimistic row is the final row — the mutation carries the same id and normalizes over it, with nothing to reconcile. Rather than wiring this by hand, declare it on the mutation with `optimisticRoots`: the hook applies the splice before the request and rolls it back automatically on failure (re-inserting a removed row at its index, evicting a failed add's record) — the membership counterpart to `optimistic`'s field writes:

```tsx
const [add] = useMutation(selector, {
  optimisticRoots: (roots, vars) =>
    roots.append("todos", { __typename: "Todo", id: vars.id, title: vars.title, completed: false }, { prepend: true }),
});
// the handler is just: await add({ id: crypto.randomUUID(), title })  — splice + rollback handled
```

No list-mutation convention is baked into the compiler (no `@appendNode`-style directive); membership is a plain runtime primitive — call `appendToRoot`/`removeFromRoot` directly where you know the intent (e.g. a post-confirmation splice), or declare `optimisticRoots` to fold it into the mutation's optimistic/rollback lifecycle.

## Mutations & invalidation

The write side. A mutation runs through the same adapter as a query; its result is normalized into the cache, so any entity it returns (`__typename + id`) updates *in place* and every read of that entity reflects the change for free. On top of that: `userErrors`, optimistic writes with automatic rollback, and invalidation.

```tsx
const result = await runMutation({
  operation, variables, adapter, context, runtime,
  optimistic: (tx) => tx.set(productRef, "title", "Renamed"), // rolled back on failure
  invalidate: (data) => [collectionRef],                  // refetch on next read
});
result.ok;          // false on transport errors OR userErrors
result.userErrors;  // [{ field, message, code }]
```

It never rejects for logical failures — inspect `ok`/`userErrors`/`errors`. `createMutator` binds one callable per compiled mutation operation as the `glean.mutate.*` namespace; `invalidate` / `invalidateField` drop records (and clear pending reads) so the next read re-fetches.

## Client hooks (islands)

The generated `@gleanql/client/client` entrypoint exposes two compile-time hooks for `"use client"` islands — both thin shims over `createGraphClient` (`src/glue-client.ts`). Each takes a *selector* or a live graph *value* that runs only at compile time: the compiler reads it to build the operation, the build injects the precompiled operation name into the call, and the runtime executes that op. No schema convention is baked into core — the reads define the operation, the same philosophy as `usePaginated`/`refresh`.

**`useMutation` (gqty-style).** The selector roots at the schema's `Mutation` type. The compiler walks it into a `kind:"mutation"` operation: the first `m.field(args)` call is the mutation root (its args lift to operation variables), and the chain after it (`.cart.totalQuantity`, `.title`) is the result selection. The selector never runs at runtime — it types `data` while the runtime runs the injected `opName`. Returns `[mutate, state]`; `mutate(vars)` runs the same engine as the server `runMutation` (optimistic writes with rollback, `userErrors`, invalidate — all passed through the options), folds the result into the normalized cache (returned entities carry `__typename + id`, so they update in place), and never rejects for logical failures (inspect `ok`/`userErrors`/`errors` on the returned `MutationResult`). The hook needs no cache subscription: its `state` drives loading/data, and a displayed entity reacts through `useGlean`.

```tsx
const [rename, { isLoading, data, error, userErrors }] = useMutation(
  (m, vars) => m.setProductTitle(vars).title,        // selector: compile-time only, never runs
  { onCompleted, onError, optimistic, update, invalidate }, // options, all optional
);
await rename({ id, title });   // mutate(vars) → Promise<MutationResult>; resolves even on failure
```

**`usePaginated`.** Paginate a connection you already read in render — pass the value (`glean.collection({ handle }).products({ first })`), and `fetchMore(args)` re-runs that connection's selection with your `args` (whatever cursor/offset convention your schema uses) and merges the page in. No pagination convention is assumed and nothing is auto-selected: you read `pageInfo`/cursors yourself, so the compiler includes exactly what you use. Default `merge` concatenates `nodes`; pass `merge` for de-dupe/sort (its helpers — `existing`, `incoming`, `uniqBy`, `sortBy` — work on node *values*, i.e. graph proxies). The hook tracks the connection's own record, so it re-renders when the fetched page lands.

```tsx
const { fetchMore, isLoading, error } = usePaginated(connection, { merge });
await fetchMore({ after: endCursor });   // re-runs the selection with your args, merges the page
```

**`useSubscription` (gqty-style).** Same compile path as `useMutation`, rooted at the schema's `Subscription` type — the selector defines a `kind:"subscription"` operation and the build injects its name. On mount the hook opens the adapter's `subscribe` stream (SSE by default), folds each pushed payload into the normalized cache via `seedResult` — so any reader re-renders fine-grained — and surfaces the latest as `data` alongside `error`. Pass variables via `options.variables` (the stream re-opens when they change, and closes on unmount). Client-only: a no-op during SSR. The idiomatic display path is to read the live entity through `useGlean`, as below.

```tsx
const { data, error } = useSubscription(
  (s, vars) => s.productChanged(vars).priceRange.minVariantPrice.amount,  // compile-time selector
  { variables: { handle }, onData, onError },
);
const price = useGlean()?.product({ handle })?.priceRange.minVariantPrice.amount;  // live, in place
```

---

Next: [RedwoodSDK integration](rwsdk.md) (RSC) or [React Router integration](react-router.md) (isomorphic) — the two framework integrations.
