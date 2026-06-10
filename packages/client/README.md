# @gleanql/client

The runtime for [GleanQL](https://github.com/gleanql/gleanql) — GraphQL without
writing GraphQL. Install this in your app; the [`@gleanql/vite`](https://github.com/gleanql/gleanql/tree/main/packages/vite)
plugin generates the schema-specific pieces (the typed `glean` accessor,
compiled operations, framework glue) into it at build time.

```tsx
import { glean } from "@gleanql/client";

export function ProductPage({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <h1>{product.title}</h1>; // compiled into one operation per route
}
```

## What lives here

- **Normalized reactive cache** — entity + path identity, field-level
  re-rendering, Suspense-aware reads, batched missing-field fetches,
  reference-counted retention, LRU + staleness-aware GC.
- **Hooks** (via the generated `@gleanql/client/client` entry) — `useGlean`,
  `useMutation` (optimistic fields *and* list membership, auto-rollback),
  `useSubscription` (SSE or `graphql-ws`), `usePaginated`, `refresh`,
  `runOperation` (typed by the generated `GleanOperations` interface),
  `onEvent` (one channel for every runtime incident — wire it to Sentry).
- **Transports** — a fetch adapter with persisted-operation mode (hash-only
  requests, APQ wire shape) and a `graphql-ws` adapter; anything else plugs in
  behind the two-method `GraphClientAdapter` interface.
- **Server pieces** — request-scoped runtimes for SSR/RSC, hydration
  serialization, `runMutation`, and `createPersistedResolver` (the server-side
  persisted-operation allowlist).

## Docs

Full documentation lives in the [GleanQL repo](https://github.com/gleanql/gleanql)
— run `pnpm docs` there, or start with the Get Started guide.

MIT
