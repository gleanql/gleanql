---
title: React Router integration
group: Integrations
order: 12
---

# React Router integration

The second built-in [framework preset](vite.md) (`framework: "react-router"`), alongside RedwoodSDK. It targets **React Router 7 in framework mode** — *isomorphic, non-RSC* SSR — and exists to prove the framework binding isn't RSC-specific: the same data layer drives a structurally different host. The real, bootable app is `examples/remix-real` (`pnpm --filter @example/remix-real dev`).

> [!NOTE]
> **Isomorphic vs. RSC.** RedwoodSDK is the RSC preset (server/client split; the snapshot rides the flight stream). React Router framework mode renders the *same* route component on the server (SSR) and the client (hydration + navigation) — there is no `"use client"` boundary. So the `react-router` preset emits *no* server-component glue and *no* route transform; the snapshot travels on React Router's own loader-data channel.

## The one seam: a shared scope

Because a route component runs in both bundles, `glean.product(...)` must resolve to *one runtime per environment* that the generated `useGlean()` and hydration also share. That is a single `GraphScope`: on the server an `AsyncLocalStorage` isolates concurrent requests; on the client it is a singleton. The app exposes a **universal**, client-safe scope module (no `node:async_hooks`) — the `requestScope` the generated accessor and client glue resolve from:

```tsx
// app/graph-scope.ts — UNIVERSAL (loads in both bundles)
import { GraphScope } from "@gleanql/client";
export const scope = new GraphScope();          // client: singleton
export const activeGraph = () => scope.current();  // the accessor's resolver
```

```tsx
// app/graph.server.ts — SERVER-ONLY (.server keeps node:async_hooks out of the client)
import { AsyncLocalStorage } from "node:async_hooks";
import { scope } from "~/graph-scope";
scope.attachAls(new AsyncLocalStorage());        // upgrade the shared scope to per-request isolation
export const integration = createGraphIntegration({ schema, operations, adapter });
```

## Setup

One line wires the build (the preset scans `app/`, points the accessor at the scope module, and emits isomorphic client glue). `~` is the app alias; `ssr.noExternal` lets Vite apply that alias inside the generated glue (which lives in `node_modules`).

```tsx
// vite.config.ts
export default defineConfig({
  resolve: { alias: [{ find: /^~\//, replacement: appDir + "/" }] },
  ssr: { noExternal: ["@gleanql/client"] },
  plugins: [
    glean({ schema: "schema.graphql", framework: "react-router", endpoint: "/graphql" }),
    reactRouter(),
  ],
});
```

## Per request — the loader→render handoff

A root `middleware` preloads the matched route's operation and wraps both the loaders *and* the document render in one `scope.run(...)`, so `glean.product(...)` resolves to this request's seeded runtime everywhere it's read. (Server-only export; React Router strips it — and its `graph.server` import — from the client bundle.)

```tsx
// app/root.tsx
export const middleware = [
  async ({ request }, next) => {
    const active = await preloadForRequest(request);   // integration.preload(...)
    return active ? scope.run(active, () => next()) : next();
  },
];
```

## Serialize & hydrate (loader data, not a script)

The root loader serializes this request's cache; React Router ships it as loader data on the initial HTML *and* every `.data` navigation. The root component folds it in **during render** — so child routes read warm on the very first hydration pass (no waterfall, no mismatch). On first load it builds the client runtime on the shared scope; later navigations merge the new snapshot (`absorbHydrationPayload`).

```tsx
// app/root.tsx
export function loader() { return { graphPayload: activePayload() ?? null }; }

export default function App() {
  const { graphPayload } = useLoaderData();
  hydrate(graphPayload ?? undefined);   // build (first load) / merge (navigation); no-op on the server
  return <Outlet />;
}
```

## Components & islands

Route components read the graph directly — the same code on server and client:

```tsx
import { glean } from "@gleanql/client";
export default function Product({ params }) {
  const product = glean.product({ handle: params.handle });   // warm: SSR + client
  return <ProductHero product={product} />;
}
```

Client-interactive bits are ordinary components (no `"use client"`). The generated `@gleanql/client/client` exposes `useGlean()` (the shared graph, re-rendering fine-grained — only on the records a component read) plus `usePaginated`, `useMutation`, and `refresh`. `useGlean()` and the `glean` accessor resolve the same runtime, so there is no hydration mismatch.

```tsx
import { useGlean, refresh } from "@gleanql/client/client";

const glean = useGlean();
const views = glean?.product({ handle }).views;
// bare refresh() inside a component → the build binds it to this component's
// read-map, refetching ONLY product.views — a pruned query, not the whole page op
<button onClick={() => refresh()}>Refresh</button>
```

`refresh("OpName")` (or bare `refresh()` outside a component) re-runs a whole operation; a component-bound `refresh()` re-runs the page's root with a selection pruned to that component's read-map (+ identity), so the wire fetches a slice. Both re-seed the normalized cache, which reconciles by identity and re-renders only the components whose records changed. See [@gleanql/client](runtime.md).

## The real app — zero glue

`examples/remix-real/` is a genuine React Router 7 app that boots. It commits **no graph glue** beyond the two tiny scope modules above — schema, routes/components, a transport, and the one `vite.config.ts` line. The build provisions `@gleanql/client` into `node_modules` and the app imports by package name:

```tsx
import { glean } from "@gleanql/client";
import type { Product } from "@gleanql/client/schema";
```

Two routes (`/collections/:handle`, `/products/:handle`) compile to two operations; a `/graphql` resource route serves client refetch. Verified end-to-end: SSR warm reads, the snapshot on the loader-data stream (initial + per-navigation `.data`), field-level refetch, and an `async_hooks`-free client bundle (the `.server` module is pruned).

## Why it works without an adapter package

Everything framework-specific is the preset ([@gleanql/vite](vite.md)) plus the two app scope modules. `@gleanql/client` itself is unchanged — it only cares about the `requestScope` seam and the `GraphScope` (server ALS via `attachAls`, client singleton). No new runtime code was needed to add a structurally different framework, which is the point of the exercise.

---

Back to [Overview](index.md) · the build wiring: [@gleanql/vite](vite.md) · the RSC counterpart: [RedwoodSDK](rwsdk.md).
