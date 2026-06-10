---
title: @gleanql/client
group: Packages
order: 7
---

# `@gleanql/client` runtime

`@gleanql/client` is a Suspense-aware runtime that owns cache identity and read behavior. It delegates transport to a client adapter, so the runtime never overlaps a normalized client cache.

> [!NOTE]
> **Dependencies.** The runtime depends only on `@gleanql/core`. The package ships React hooks (`useGlean`) and the hydrator components in source (`glue-client.ts` / `glue-server.ts`), so `react` is a **peer dependency** (`>=18`).

## Client adapter (the only transport seam)

The runtime owns the graph: cache, normalization, and reactivity. The adapter owns the wire. The interface is two methods, so the transport is pluggable:

- A plain fetch adapter ships in-box. Its `subscribe` streams over Server-Sent Events by default.
- The built-in `createGraphWsAdapter` carries everything over a `graphql-ws` WebSocket.
- An app already running urql or Apollo can wrap it here.

We do *not* use a client's normalized cache — it would duplicate ours. The adapter is pure transport.

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

Request *context* holds values like an auth token, shop domain, locale, or env. The fetch adapter uses it only to build headers; graphql-ws uses it only for per-operation `extensions`. The context is never serialized into the request body or to the client.

### Persisted operations

`createFetchAdapter({ persisted: true })` sends every compiled operation **by its sha-256 hash**, never by document. The wire shape is APQ: `extensions.persistedQuery.sha256Hash`. If the server answers `PersistedQueryNotFound`, the adapter retries once with the document. The server side is one helper: `createPersistedResolver(operations)` maps an incoming body to an allowlisted document. It answers `ok`, `not-found`, or `rejected`; `allowUnpersisted` opts out of rejection.

> [!NOTE]
> The build owns both ends, so the allowlist is free — enable it with [`persisted: true` on the plugin](vite.md).

## Cache identity model

The cache has two storage identities:

| Identity | Key | When |
| --- | --- | --- |
| Normalized entity | `__typename + id` | type exposes an `id` |
| Path identity | `root + args + path` | object without `id` |
| Scalar | stored inline | leaf values |

Two query paths returning the same `__typename + id` resolve to *one* record. An update through any path is therefore visible through all of them.

```tsx
cache.recordKey(ref)            // entity identity wins over path
cache.getField(ref, fieldKey)   // → { status: "ready", value } | { status: "missing" }
cache.merge(ref, fields)
cache.invalidate(ref) · cache.invalidateField(ref, key)
cache.recordVersion(key)     // per-record counter, bumped on each write (fine-grained reactivity)
cache.snapshot() · GraphCache.fromSnapshot(snap)
```

## Suspense-aware reads

A read is synchronous on a hit. On a miss, the runtime enqueues the missing `(ref, field)`, creates exactly one cached promise, and throws it — the Suspense contract. Re-reading a pending field throws the *same* promise. There is no duplicate request, and the read stays stable across React render retries.

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

The cache carries a global `version` plus `subscribe(listener)`, bumped on every write. That pair satisfies the `useSyncExternalStore` contract and is the one notify channel. A naive subscriber on that version is *coarse*: any write re-renders every graph component. So the cache also keeps per-record version counters (`recordVersion(key)`), bumped on each write alongside the global one. `useGlean` gates its snapshot on just the records the component read — valtio's model.

**Fine-grained reactivity.** A graph proxy read records which record it touched into its binding's read tracker (`GraphBinding.tracker` in `proxy.ts`). `useGlean` binds the graph with a fresh per-render set, and the reads in that render populate it. On each notify, its `useSyncExternalStore` subscriber recomputes a digest of just those records' versions (`affectedDigest`). It re-renders only when the digest changed, so a global notify skips components whose keys are untouched. A component re-renders only when a field it read actually changed.

```tsx
function affectedDigest(cache, keys) {     // keys = what this render read (fields, or whole records)
  let out = "";
  for (const key of keys) out += `${key}:${cache.trackedVersion(key)}|`;
  return out;                            // changes iff a tracked key's version bumped
}
```

Tracking is **field-level**: a read records the exact `record + field` it touched. Two components reading different fields of the *same* entity — one reads `product.title`, another `product.views` — don't wake each other. The cache keeps both per-field versions and per-record versions. `useGlean` uses the per-field versions; `usePaginated` tracks its connection's whole record and re-renders when a page lands. `trackedVersion` resolves a tracked key at its own granularity.

Attribution is **per binding**. `useGlean` binds the graph with this render's own `affected` set, so reads through its proxies record into it directly. The set is fiber-local, so interleaved concurrent renders can't cross-attribute. A module-global tracker stays only as a fallback for the trackerless server / isomorphic accessor. SSR is a no-op.

`useMutation` needs no cache subscription. Its state drives loading/data, and a displayed entity reacts through `useGlean`.

Beyond the per-key digest, `useGlean` also re-renders on a **page-pointer change** — hydration or client navigation. Root resolution changes for every reader then. An island that first rendered before hydration re-resolves its roots and re-tracks the right keys, rather than staying bound to a stale pre-hydration path ref.

`runRoute` is *cache-first*. It persists each root call's link (`product(handle:"x") → Product:123`). On a re-run, it serves from the cache when the full selection is already present, skipping the network. `refetch()` bypasses that to force a fresh fetch. The re-seed bumps the version, and only the components whose records changed update.

## Store retention & GC (reference-counted, Relay-style)

The same read-tracking that drives fine-grained re-rendering also drives **retention**. Post-commit, a tracking hook (`useGlean` / `usePaginated`) *retains* the records this render read — a reference count on each record. It re-diffs the set every render and releases on unmount. Retained records are privileged twice:

- **LRU eviction skips them.** With a `maxCacheRecords` cap, the eviction victim is the coldest *unretained* record — what's on screen is never evicted, even if it's the oldest.
- **`cache.gc()` sweeps only the unretained.** Version counters survive collection, so a refetched record stays monotonic for its trackers.

But "unretained" alone is *not* a reason to drop data — a back-navigation should hit a warm cache. So automatic collection is staleness-aware and opt-in. The cache carries a generation clock: `advanceEpoch()` advances it per navigation, and every read/write/retain re-stamps a record. `gc({ keepEpochs: N })` drops only records that are unretained *and* untouched for N generations. The plugin's [`gcKeepPages`](vite.md) option wires this to navigations. Bare `gc()` remains the full reset (logout). `maxCacheRecords` (LRU) bounds capacity; the epoch clock bounds staleness.

```tsx
cache.retain(key)      // pin a record; returns the matching release (idempotent)
cache.isRetained(key)
cache.gc()              // drop every unretained record; returns how many

// The hooks do this automatically — manual retain() is only for non-React readers.
```

## Error surfaces

Each surface has exactly one error channel:

- A failed `fetchMissing` *rejects* the suspended read's promise — the React error-boundary contract. Pair every route/island with a boundary.
- `unexpectedMissingField: "error"` throws synchronously on reads the compiler should have covered.
- `runRoute` returns `errors` beside `roots` — the preload 404 branch.
- Mutations never throw on logical failures. `MutationResult` carries `error` (transport/GraphQL) and `userErrors` (your schema's), and optimistic writes roll back on either.
- The fetch adapter turns non-JSON responses into a clear transport error. GraphQL `errors` always ride the result object.

**Central observability:** `createGraphClient({ onEvent })` mirrors every runtime incident to one channel:

- `refresh-error`
- `mutation-error` — transport/GraphQL only; `userErrors` are expected outcomes and not reported
- `subscription-error`
- `persisted-retry` — the server didn't know a hash
- `gc` — something was collected on navigation

Wire it to Sentry & friends. A throwing listener is swallowed — observability must never break the app. Cyclic optimistic data fails normalization with a clear `circular reference` error instead of a stack overflow.

## Missing-field batching

Multiple misses in the same tick batch into a single `fetchMissing` call — one patch operation. One render pass produces at most one patch request, no matter how many fields it missed.

```tsx
new GraphRuntime({
  fetchMissing: (misses) => Promise<MissingFieldResult[]>, // the seam to your transport
  cache?,
  unexpectedMissingField?: "allow" | "warn" | "error", // hybrid / strict
  schedule?, onWarn?,
})
```

## Seeding & result normalization

Every object selection includes `__typename`, plus `id` when available. A GraphQL JSON result therefore carries enough information to normalize itself into the cache — no selection needed:

```tsx
runtime.seedResult(data) // returns each root field's ref for reading

// __typename + id → entity record;  otherwise → path record;
// scalars inline; object fields store a ref; lists store arrays of refs/scalars
```

## Runtime graph proxies

The compiler infers *what* to fetch; the proxies make ordinary reads actually *execute*. A graph value is a Proxy over a cache ref. Property access routes through the Suspense-aware runtime:

- A scalar reads through.
- An object field re-wraps as a child proxy.
- A list maps to child proxies.
- A field with arguments becomes a callable.

Nothing in userland sees a ref, a selection, or a promise.

```tsx
const graph = bindGraph({ schema, getRuntime, roots }); // roots from runRoute()
const product = graph.product({ handle });            // proxy over the seeded ref
product.title                         // scalar → cache read (sync hit / throws promise)
product.featuredImage?.url            // object → child proxy; null short-circuits
collection.products({ first: 12 }).nodes  // callable + list → array of proxies
product.selection                     // escape hatch: { ref, type }
```

A lone callable field reads by its plain name. Argument-conflicting variants the compiler aliased (`url_transformMaxWidth300`) resolve by their argument-derived key. The proxy tries the most-specific key first, then the plain name, so it is correct without knowing about conflicts.

## Request scope

A module-level `import { glean } from "@gleanql/client"` must resolve to *the runtime for the current request* on the server, because concurrent requests must not share a cache. In the browser, it must resolve to a singleton. `GraphScope` is that seam. Back it with `AsyncLocalStorage` for automatic per-request isolation, or resolve from the framework's own request context.

```tsx
scope.run(active, fn)  // server: install the request runtime for this render
scope.current()        // what `glean` resolves to (throws outside any scope)
scope.set(active)      // client: install the singleton after hydration
```

## The route flow (framework seam)

A compiled operation, a client adapter, and a request context are enough to drive a route. A framework adapter (RWSDK first) answers two questions: "which operation for this entrypoint?" and "how do I build the request context?".

```tsx
await runRoute({ operation, routeContext, adapter, context, runtime });
// 1 compute variables  2 execute  3 seed cache  → { variables, roots, errors }
```

The preferred end-to-end flow:

1. The adapter identifies the entrypoint.
2. Load the generated operation.
3. Compute variables from params/search/context.
4. Fetch, then seed the cache.
5. Components render and read synchronously; missing/lazy fields suspend.

## Hydration — two models

There are two ways the server cache reaches the client, picked by the host.

**SSR `<script>` (non-RSC hosts).** The server renders against a server-side cache and serializes `runtime.snapshot()` plus root handles. The client recreates the cache with `GraphRuntime.hydrate(snapshot, options)`. It can still Suspense-fetch missing fields through its adapter. The payload is published once on `window` and read once — simple and synchronous.

**RSC flight (React Server Components).** Under RSC the `Document` shell renders once, but each client navigation re-streams *only the page subtree*. A one-shot global therefore goes stale on navigation. Instead, the snapshot rides the RSC flight stream as a *client-component prop* — it is plain JSON by construction. On every (re)render, that component folds it into a single **long-lived** client runtime. The cache *accumulates* across navigations rather than being rebuilt. The primitives:

```tsx
runtime.absorbRecords(snapshot)     // fold a snapshot, write-only (no notify); → changed?
runtime.notify()                    // bump version + run listeners (after absorbRecords)
runtime.absorb(snapshot)            // absorbRecords + notify, in one call

absorbHydrationPayload(runtime, payload)  // render-phase merge (write-only); idempotent
pagePointer(payload)                      // → GraphPagePointer: operation + vars for refresh()
```

One typed factory, `createGraphClient` (`src/glue-client.ts`), drives both models. Omit a scope for the RSC private singleton, fed by `<GraphHydrator>`. Pass the app's shared scope for isomorphic SSR, where the host calls `hydrate(payload)`. Its server counterpart, `createGraphServer` (`src/glue-server.ts`), produces `GraphHydrate` / `withGraphHydration`. The generated `@gleanql/client/client` and `@gleanql/client/server` entrypoints are thin shims over these factories. They re-export `useGlean` / `refresh` / `hydrate` / `GraphHydrator` and `GraphHydrate` / `withGraphHydration`. The typed logic lives in source, not template strings. See [@gleanql/vite](vite.md).

`absorbHydrationPayload` is a render-phase merge: write-only, with no subscriber notify. The caller bumps in a commit-phase effect. That makes it safe to call during render and idempotent across React retries. `pagePointer` derives the current operation + variables a client island uses to `refresh()`. Because the runtime is long-lived, `bindGraph`'s `roots` can be a getter, resolved per call. The bound graph then follows the page-current roots across navigations.

## Client-side `refresh()`

`refresh(operationName?)` re-runs the **entire** compiled operation for the current page, or the named one, over the wire. It bypasses cache-first — `refetch` in `route.ts` calls `runRoute` with `cacheFirst: false` — and re-seeds the cache. The network request fetches the *whole* operation, not a field-level slice. The normalized cache then reconciles by entity identity (`__typename + id`). Only fields that actually changed re-render, but the over-the-wire payload is the full operation. To refetch a smaller slice today, pass a smaller operation name. The current page's operation + variables come from `pagePointer`. The re-seed bumps the cache version, so subscribers (`useGlean`) re-render.

## List-root membership (`appendToRoot` / `removeFromRoot`)

A **list root** keeps its membership in the page pointer's `roots` array — *not* in any normalized record. An example: `type Query { todos: [Todo!] }`, read as `glean.todos()`. A field change to an element (a toggle) reconciles by identity for free. But **adding or removing an element changes the root array**, which a reader only sees by re-resolving roots. So instead of `refresh()`-ing the whole list after every add/remove, splice membership in place:

```tsx
appendToRoot("todos", entity, { prepend?, at? }) // add — dedupes; { at } inserts at an index
removeFromRoot("todos", entity)              // remove — entity, { __typename, id }, or a ref
```

Each helper resolves the entity's ref, rewrites `currentPage.roots[field]`, and bumps the page epoch. Root readers then re-resolve and re-render. There is no network round-trip. For an *object* root the ref is stable, so these are a no-op there — its field-version bump already drives the update.

**Optimistic UI.** Pass a client-built entity with its fields, and `appendToRoot` also *seeds* them into the cache, id included. The row then renders *before* the server responds. Generate the id client-side so the optimistic row is the final row. The mutation carries the same id and normalizes over it, with nothing to reconcile. Rather than wiring this by hand, declare it on the mutation with `optimisticRoots`. The hook applies the splice before the request and rolls it back automatically on failure — re-inserting a removed row at its index, evicting a failed add's record. This is the membership counterpart to `optimistic`'s field writes:

```tsx
const [add] = useMutation(selector, {
  optimisticRoots: (roots, vars) =>
    roots.append("todos", { __typename: "Todo", id: vars.id, title: vars.title, completed: false }, { prepend: true }),
});
// the handler is just: await add({ id: crypto.randomUUID(), title })  — splice + rollback handled
```

No list-mutation convention is baked into the compiler — there is no `@appendNode`-style directive. Membership is a plain runtime primitive. Call `appendToRoot`/`removeFromRoot` directly where you know the intent (e.g. a post-confirmation splice). Or declare `optimisticRoots` to fold it into the mutation's optimistic/rollback lifecycle.

## Mutations & invalidation

This is the write side. A mutation runs through the same adapter as a query. Its result is normalized into the cache, so any entity it returns (`__typename + id`) updates *in place*. Every read of that entity reflects the change for free. On top of that, mutations add `userErrors`, optimistic writes with automatic rollback, and invalidation.

```tsx
const result = await runMutation({
  operation, variables, adapter, context, runtime,
  optimistic: (tx) => tx.set(productRef, "title", "Renamed"), // rolled back on failure
  invalidate: (data) => [collectionRef],                  // refetch on next read
});
result.ok;          // false on transport errors OR userErrors
result.userErrors;  // [{ field, message, code }]
```

`runMutation` never rejects for logical failures — inspect `ok`/`userErrors`/`errors`. `createMutator` binds one callable per compiled mutation operation as the `glean.mutate.*` namespace. `invalidate` / `invalidateField` drop records and clear pending reads, so the next read re-fetches.

## Client hooks (islands)

The generated `@gleanql/client/client` entrypoint exposes two compile-time hooks for `"use client"` islands. Both are thin shims over `createGraphClient` (`src/glue-client.ts`). Each takes a *selector* or a live graph *value* that runs only at compile time. The compiler reads it to build the operation. The build injects the precompiled operation name into the call, and the runtime executes that op. No schema convention is baked into core. The reads define the operation — the same philosophy as `usePaginated`/`refresh`.

**`useMutation` (gqty-style).** The selector roots at the schema's `Mutation` type, and the compiler walks it into a `kind:"mutation"` operation. The first `m.field(args)` call is the mutation root; its args lift to operation variables. The chain after it (`.cart.totalQuantity`, `.title`) is the result selection. The selector never runs at runtime — it types `data` while the runtime runs the injected `opName`. The hook returns `[mutate, state]`. `mutate(vars)` runs the same engine as the server `runMutation`: optimistic writes with rollback, `userErrors`, and invalidate all pass through the options. It folds the result into the normalized cache — returned entities carry `__typename + id`, so they update in place. It never rejects for logical failures; inspect `ok`/`userErrors`/`errors` on the returned `MutationResult`. The hook needs no cache subscription. Its `state` drives loading/data, and a displayed entity reacts through `useGlean`.

```tsx
const [rename, { isLoading, data, error, userErrors }] = useMutation(
  (m, vars) => m.setProductTitle(vars).title,        // selector: compile-time only, never runs
  { onCompleted, onError, optimistic, update, invalidate }, // options, all optional
);
await rename({ id, title });   // mutate(vars) → Promise<MutationResult>; resolves even on failure
```

**`usePaginated`.** Paginate a connection you already read in render. Pass the value, e.g. `glean.collection({ handle }).products({ first })`. `fetchMore(args)` re-runs that connection's selection with your `args` and merges the page in. Use whatever cursor/offset convention your schema has. No pagination convention is assumed and nothing is auto-selected. You read `pageInfo`/cursors yourself, so the compiler includes exactly what you use. The default `merge` concatenates `nodes`; pass `merge` for de-dupe/sort. Its helpers — `existing`, `incoming`, `uniqBy`, `sortBy` — work on node *values*, i.e. graph proxies. The hook tracks the connection's own record, so it re-renders when the fetched page lands.

```tsx
const { fetchMore, isLoading, error } = usePaginated(connection, { merge });
await fetchMore({ after: endCursor });   // re-runs the selection with your args, merges the page
```

**`useSubscription` (gqty-style).** This hook shares `useMutation`'s compile path, rooted at the schema's `Subscription` type. The selector defines a `kind:"subscription"` operation and the build injects its name. On mount the hook opens the adapter's `subscribe` stream — SSE by default. It folds each pushed payload into the normalized cache via `seedResult`, so any reader re-renders fine-grained. It surfaces the latest payload as `data` alongside `error`. Pass variables via `options.variables`. The stream re-opens when they change and closes on unmount. The hook is client-only: a no-op during SSR. The idiomatic display path is to read the live entity through `useGlean`, as below.

```tsx
const { data, error } = useSubscription(
  (s, vars) => s.productChanged(vars).priceRange.minVariantPrice.amount,  // compile-time selector
  { variables: { handle }, onData, onError },
);
const price = useGlean()?.product({ handle })?.priceRange.minVariantPrice.amount;  // live, in place
```

---

Next, the two framework integrations: [RedwoodSDK integration](rwsdk.md) (RSC) or [React Router integration](react-router.md) (isomorphic).
