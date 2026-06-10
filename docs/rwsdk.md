---
title: RedwoodSDK integration
group: Integrations
order: 11
---

# RedwoodSDK integration

A framework integration target — now one of **two** built-in [framework presets](vite.md) (alongside React Router 7). RedwoodSDK is an *adapter*, not the foundation — the core compiler and runtime have no dependency on it. Like `@gleanql/vite` is to Vite, this package is decoupled from `rwsdk` itself: it matches the framework's shapes structurally (a `RequestInfo`), so it tests in isolation and pins no framework version.

> [!NOTE]
> **RSC vs. isomorphic.** RedwoodSDK is the *RSC* preset (server/client split; the graph snapshot rides the flight stream). The `react-router` preset proves the binding is pluggable with an *isomorphic, non-RSC* host — see `examples/remix-real` and [@gleanql/vite](vite.md).

## What an adapter answers

Any framework adapter has to answer four questions. This package answers them:

| Question | How |
| --- | --- |
| Which operation drives this entrypoint? | `resolveOperationName` / an explicit name passed to `preload` |
| How do we read params/search/request/env? | `buildRouteContext(requestInfo, { context })` |
| How do we preload + seed? | `runRoute` into a fresh *per-request* cache |
| How do we expose the graph & hydrate? | bound graph on `ctx` + `serializeGraph`/`hydrateGraph` |

## Setup

Create one integration with the compiled operations (generated into `@gleanql/client`), the schema, and a transport adapter. `context` contributes auth/locale/env; `clientSafeContext` is the allow-list of context keys safe to serialize — secrets stay server-side.

```tsx
const integration = createGraphIntegration({
  schema, operations, adapter,
  context: ({ request }) => ({ locale: localeFor(request), accessToken: env.TOKEN }),
  clientSafeContext: ["locale"],          // accessToken is NOT serialized
  unexpectedMissingField: "warn",          // hybrid mode
  fetchMissing,                            // optional: batched lazy/patch fetcher
});
```

## Per request

Preload picks the operation, computes variables from the `RequestInfo`, executes via the adapter, seeds a fresh cache, and attaches `{ runtime, graph, roots, variables }` to `requestInfo.ctx`. Concurrent requests are isolated in separate caches.

```tsx
await integration.preload(requestInfo, "ProductRoute");
const graph = integration.getGraph(requestInfo);
// Pages/components read normally — cache hits, no GraphQL in sight:
const product = graph.product({ handle: params.handle });
product.title;  product.featuredImage?.url;  product.priceRange.minVariantPrice.amount;
```

If you prefer a module-level import over reading `ctx` — an app-owned module (say `~/graph`) re-exporting a scoped accessor — back the integration with a `GraphScope` and wrap rendering in `integration.runInScope(requestInfo, render)`.

## Serialize & hydrate

Graph values are proxies, not JSON — so the cache is serialized, not the values. The hydration script escapes its payload so it cannot break out of the `<script>` element (`<`, `>`, `&`, U+2028/U+2029). On the client, the runtime is rebuilt from the snapshot and the graph re-bound; warm reads hit, missing fields fetch through the client adapter.

```tsx
// Server (in the Document):
const payload = serializeGraph(integration.getActive(requestInfo)!, { clientSafeContext: ["locale"] });
head += renderGraphHydrationScript(payload, { nonce });

// Client:
const { graph } = hydrateGraph(readGraphHydrationPayload()!, { schema, adapter });
```

## Boundary rules

- Graph values are serializable as *handles + cache records*, never as live proxies.
- Only `clientSafeContext` keys cross to the client; tokens/secrets are dropped.
- Client components can trigger runtime missing-field fetches through the client adapter.
- Two hydration models ship: the simple SSR `<script>` model and the RSC flight model (snapshot as a client-component prop, folded into a long-lived runtime). See [@gleanql/client](runtime.md).

## Mutations

The integration also exposes the write side per request: `getMutator(requestInfo)` returns the `glean.mutate.*` namespace (one callable per compiled mutation operation), and `invalidate(requestInfo, value)` drops a record so the next read re-fetches. Results normalize into the per-request cache, so a mutation is immediately visible through the already-rendered graph.

```tsx
const result = await integration.getMutator(requestInfo).ProductUpdate(
  { id, title: "Renamed" },
  { optimistic: (tx) => tx.set(productRef, "title", "Renamed") },
);
```

## Client islands & refetch (mixing client + RSC)

RSC renders the page server-side; a `"use client"` island can refetch live — with **no hydration boilerplate**. The plugin generates the client glue too: a `@gleanql/client/client` module exposing `useGlean()` (the hydrated graph, re-rendering on cache change) and `refresh(operationName?)` (re-run the page's compiled operation over the wire). The app just imports them.

```tsx
// a "use client" island — the only graph code the app writes
import { useGlean, refresh } from "@gleanql/client/client";

const glean = useGlean();                       // hydrated; re-renders on cache change
const product = glean.product({ handle });   // warm read from the hydrated cache
// <button onClick={() => refresh()}> → /graphql → re-seed → cache notifies → re-render
```

`refresh(operationName?)` re-runs the *entire* compiled operation for the current page (or the named one), bypassing cache-first, and re-seeds — it is a whole-operation refetch, not a field-level one. The normalized cache then reconciles by entity identity, so only changed fields actually re-render, but the network request fetches the whole operation; to refetch a smaller slice today, pass a smaller operation name.

Under the hood the snapshot rides the **RSC flight stream**, not a `<script>` global: `@gleanql/vite` auto-injects a `<GraphHydrate />` server component (from the generated `@gleanql/client/server` — a thin shim over `createGraphServer`) around each route component (the preset's `transformRoute` hook), passing this request's serialized payload. On every render the client side folds it into **one long-lived** browser runtime (`absorbHydrationPayload` → `runtime.absorbRecords`, so the cache accumulates across navigations) pointed at the configured `endpoint` (default `/graphql`), and wires `useSyncExternalStore` to `cache.subscribe`. It builds on the *client-safe* entrypoints `@gleanql/client/runtime` + `@gleanql/client/operations` (no request-scoped accessor → no server-only `rwsdk/worker` in the client bundle). Zero app glue: worker and page files are untouched, and there is no inline state `<script>`, so it sidesteps CSP.

## A mutation island — writes update in place

The write side is a client island too, with the **same zero graph glue**. The generated `@gleanql/client/client` also exports `useMutation` (gqty-style). The selector `(m, vars) => …` is **compile-time only** — it defines the operation (rooted at the `Mutation` type) and types `vars`/`data`, but never runs: the build injects the compiled op name into the call site. Calling `rename(vars)` runs that op, and because the mutation returns the entity (`__typename` + `id`), the result normalizes *in place* into the same cache the page hydrated — so any island reading that record through `useGlean()` updates with no reload.

```tsx
// a "use client" mutation island — the only graph code the app writes
import { useGlean, useMutation } from "@gleanql/client/client";

const glean = useGlean();                       // hydrated; re-renders fine-grained
const product = glean?.product({ handle });
const title = product?.title ?? initialTitle; // reads the record the mutation writes

const [rename, { isLoading, error }] = useMutation(
  (m, vars) => m.setProductTitle(vars).title,   // compile-time selector → kind:"mutation" op; never runs
);
// <button onClick={() => rename({ id, title })}> → /graphql → returns {__typename,id,title}
//   → normalized in place → only THIS record's readers re-render → heading updates, no reload
```

Same engine as the server-side `runMutation` — `optimistic` / `update` / `invalidate` are available through the hook's options, and `userErrors` surface on the returned state. See `examples/rwsdk-real`'s `RenameTitle.tsx`.

## The real app — zero glue (`@gleanql/vite`)

`examples/rwsdk-real/` is a genuine RedwoodSDK app (React 19 RSC on workerd) that *boots* (`pnpm --filter @example/rwsdk-real dev`). It commits **no graph glue at all** — just a schema, routes/components, a transport, and one line in `vite.config.mts`:

```tsx
// vite.config.mts
import { defineConfig } from "vite";
import { glean } from "@gleanql/vite";

export default defineConfig({
  plugins: [
    glean({ schema: "schema.graphql" }),  // routes auto-discovered
    cloudflare(),
    redwood(),
  ],
});
```

On startup (before the directive scan) the plugin provisions the `@gleanql/client` runtime, runs `@gleanql/codegen` from the schema, compiles the route files with `@gleanql/compiler`, and emits a real **`@gleanql/client`** package into `node_modules` whose `package.json` `exports` declare the generated types. So app code imports by package name — no tsconfig paths, no alias:

```tsx
import { glean } from "@gleanql/client";
import type { Product } from "@gleanql/client/schema";
```

Two routes (a list `/collections/:handle` and a detail `/products/:handle`) compile to two operations; components live in separate files and the compiler follows the imports. Verified end-to-end on real workerd, including client hydration in the browser.

## In-CI worker (no workerd)

`examples/storefront/rwsdk-app/` is a RedwoodSDK-*shaped* worker (`defineApp`/`route`/`Document` from a local shim, since real `rwsdk/worker` needs workerd) that runs in the test suite — `worker.fetch(request)` → an HTML `Response` with the rendered page + hydration payload. It gives CI coverage of the integration without the workerd toolchain.

## Status

Reads *and* writes are complete end-to-end: `examples/storefront/rwsdk.test.ts` drives the *real* compiler output for `ProductRoute.tsx` through the adapter — request → preload → proxy reads → serialize → hydrate — `packages/rwsdk/test/integration.test.ts` covers the mutation + optimistic + invalidation flow, and `rwsdk-app/worker.test.ts` runs the whole thing as a `fetch` handler. RSC-native serialization now ships too — the snapshot rides the flight stream and folds into a long-lived runtime — verified end-to-end on real workerd in `examples/rwsdk-real`.

---

Back to [Overview](index.md) · the runtime that powers this: [@gleanql/client](runtime.md).
