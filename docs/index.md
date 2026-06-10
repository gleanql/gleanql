---
title: Overview
group: Guide
order: 1
---

# GleanQL — TypeScript-Native GraphQL Query Compiler

You write plain React components. GleanQL's compiler reads them at build time
and writes the GraphQL for you — one operation per route, typed, hashed, and
allowlisted. There are no queries, fragments, or `useQuery` wrappers anywhere
in your app code.

## The idea in one screen

Field access *is* the data requirement:

```tsx
import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }) {
  const product = glean.product({ handle: params.handle });
  return <><ProductHero product={product} /><BuyBox product={product} /></>;
}

function BuyBox({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  return <button>{price.amount} {price.currencyCode}</button>;
}
```

The compiler reads those property accesses across the whole route — following
the value through JSX props into `BuyBox` — de-duplicates them, and emits one
operation:

```graphql
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
    featuredImage { __typename url }
    priceRange {
      __typename
      minVariantPrice { __typename amount currencyCode }
    }
  }
}
```

Notice what's *not* in the component: no fragment, no `select` block, no
generated `ProductRef` type. `Product` looks like the schema type, because it
is one.

## Everything else follows the same rule

The read side is half the story. Writes, live data, and re-rendering all keep
the same contract — you express intent in plain TypeScript, the build does the
GraphQL:

- **Mutations** are compile-time selectors: `useMutation((m, vars) =>
  m.cartLinesAdd(vars).cart.totalQuantity)` becomes a named operation, and its
  result normalizes into the cache so every read of the mutated entity updates
  in place.
- **Subscriptions** compile the same way and stream over SSE or `graphql-ws`;
  each pushed payload folds into the cache.
- **Re-rendering is field-grained.** The normalized cache versions each
  record, so a component re-renders only when a record *it actually read*
  changes.
- **The wire can be locked.** Every build emits a sha-256 allowlist of every
  operation the app can send; flip `persisted: true` and only known hashes
  cross the network.

The [task tour](usage.md) walks each of these with running code.

## The packages

An app installs **two** packages — the runtime it imports from, and the build
plugin that generates everything into it. The other three are internal
building blocks.

<div class="cards">
  <div class="card"><h3>@gleanql/client</h3><p>The runtime you install: cache, Suspense, graph proxies, request scope, transports, the React hooks — plus a <code>generated/</code> slot for the schema.</p><a href="/runtime">Read →</a></div>
  <div class="card"><h3>@gleanql/vite</h3><p>The build plugin: provisions <code>@gleanql/client</code>, runs codegen + the compiler, and writes the <code>glean</code> accessor / types / operations into it.</p><a href="/vite">Read →</a></div>
  <div class="card"><h3>@gleanql/core</h3><p>Query IR, the <code>q.*</code> builder, the selection merger, the GraphQL printer, schema model, devtools.</p><a href="/core">Read →</a></div>
  <div class="card"><h3>@gleanql/compiler</h3><p>Backend seam + a <code>typescript</code> backend, and the analyzer that extracts reads &amp; prop flow.</p><a href="/compiler">Read →</a></div>
  <div class="card"><h3>@gleanql/codegen</h3><p>Introspection → the <code>SchemaModel</code>, branded TS types, and the <code>glean</code> accessors.</p><a href="/codegen">Read →</a></div>
</div>

## How a build works

```flow
  .tsx source
      │
      ▼
  ┌──────────────────────────┐     GraphCompilerBackend (typescript default,
  │  @gleanql/compiler        │ ◀── experimental tsgo — same interface)
  │  analyzer + backend seam  │
  └──────────────────────────┘
      │  builds a mutable selection tree + read map + variables
      ▼
  ┌──────────────────────────┐
  │  @gleanql/core            │  merge → inject identity → alias → order → print
  │  IR · merger · printer    │
  └──────────────────────────┘
      │  OperationArtifact { document, variables, readMap, hash, stats }
      ├──────────────▶ @gleanql/vite  → generates into @gleanql/client
      ▼
  ┌──────────────────────────┐
  │  @gleanql/client          │  seed cache → sync reads → Suspense on misses
  │  cache · Suspense · batch │  → batched patch fetch → hydrate
  └──────────────────────────┘
```

Every generated operation is validated against the real schema with
graphql-js, and the whole pipeline is locked by ~400 tests — including golden
fixtures run through two type-checker engines.

## Where to go

1. **[Get started](get-started.md)** — install two packages, point the plugin
   at your schema, write a component. Five steps, no GraphQL.
2. **[Using GleanQL](usage.md)** — the task tour: read, mutate, paginate,
   subscribe, go optimistic, lock down the wire.
3. **[vs Relay & gqty](comparison.md)** — where GleanQL sits: gqty's developer
   experience with Relay's runtime characteristics.
4. **[Architecture & pipeline](architecture.md)** — the worked example, stage
   by stage, for the internals.

> [!NOTE]
> **Three bootable examples** live in the repo: `examples/rwsdk-real` (a
> RedwoodSDK storefront — islands, live SSE prices, persisted mode, a typed
> registered operation), `examples/rwsdk-todo` (TodoMVC on a SQLite Durable
> Object with optimistic membership), and `examples/remix-real` (the same data
> layer on React Router 7 — isomorphic SSR, no RSC). None commit any generated
> glue.
