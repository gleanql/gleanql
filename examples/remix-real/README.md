# Glean · React Router 7 (framework mode)

A real, bootable **React Router 7** app on the same data layer as
[`examples/rwsdk-real`](../rwsdk-real) — proving the framework binding is pluggable,
not RedwoodSDK/RSC-specific.

```
pnpm --filter @example/remix-real dev   # http://localhost:5173
```

## What this proves

RedwoodSDK is **RSC** (server/client component split; the graph snapshot rides the
flight stream). React Router 7 framework mode is **isomorphic, non-RSC** — the same
route component renders on the server (SSR) and the client (hydration + navigation).
The data layer adapts to both through one seam, the `@gleanql/vite` **framework preset**:

- `vite.config.ts` selects `framework: "react-router"`. That preset scans `app/`,
  points the generated `graph` accessor at the app's scope module, emits **isomorphic
  client glue** (no `"use client"`, no private singleton), and emits **no** RSC server
  component and **no** route transform.
- `app/graph-scope.ts` is the **universal** scope (`new GraphScope()`, client-safe).
  `app/graph.server.ts` (server-only `.server` suffix) attaches an `AsyncLocalStorage`
  so the *same* `graph` accessor resolves to the request's runtime on the server and to
  the hydrated runtime on the client — one runtime per environment, shared by
  `graph.product()` and `useGraph()`.

## How a request flows

1. **Root middleware** (`app/root.tsx`) preloads the matched route's operation, seeds a
   fresh per-request cache, and wraps both the loaders and the document render in
   `scope.run(active, …)`. So `graph.product(...)` reads warm during SSR.
2. The **root loader** serializes the cache; React Router ships it as loader data.
3. The **root component** calls `hydrate(payload)` during render — on the client's first
   pass it builds the runtime on the shared scope (so children read warm with no
   waterfall / no hydration mismatch); on later navigations it merges the new snapshot.
4. **Client navigation** re-runs the loader via a `.data` request (middleware re-seeds,
   loader re-serializes); the root re-renders and merges. `refresh()` POSTs to `/graphql`
   and re-seeds reactively — the "Refresh" button bumps `views`.

## Verify

- View-source on `/products/cool-shirt`: product fields are rendered server-side and the
  loader data carries the cache (warm first paint, no client fetch).
- Navigate collection → product → product: each paints from cache; the Network tab shows
  `.data` requests, not per-field GraphQL waterfalls.
- Click **Refresh (client refetch)**: `views` increments (the `/graphql` round-trip +
  reactive shared runtime).
- Console is clean — the isomorphic `graph` accessor and `useGraph()` share one runtime.

No graph glue is committed: `@gleanql/vite` generates everything into `@gleanql/client` in
`node_modules` from `schema.graphql`. The app imports `@gleanql/client` (+ `/client`,
`/schema`).
