---
title: Overview
group: Guide
order: 1
---

# GleanQL — TypeScript-Native GraphQL Query Compiler

A framework-agnostic data system that uses GraphQL *internally* but never exposes GraphQL documents, fragments, or selector blocks in application code. Components look like ordinary React/TypeScript; the compiler infers the operation from normal field reads and prop flow.

## The idea in one screen

You write plain components. Field access *is* the data requirement.

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

The compiler reads those property accesses across the whole route, follows the value through JSX props, de-duplicates, and emits one operation — plus a variables factory and a per-component read map:

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

> [!NOTE]
> **No GraphQL in app code.** No hand-written fragments, no `select` blocks, no `dataComponent(...)` wrappers, no exposed `ProductRef` type. Userland types look like schema types (`Product`, `Image`, `MoneyV2`).

> [!NOTE]
> **Writes, the same way.** Mutations are compile-time too: a gqty-style `useMutation((m, vars) => m.cartLinesAdd(vars).cart.totalQuantity)` selector compiles to a named operation — no schema convention, no hand-written document. The result normalizes into the cache, so every read of a mutated entity updates in place.

> [!NOTE]
> **Fine-grained reactivity.** The normalized cache versions each record, so a component re-renders only on the records it actually read — a mutation or refetch skips the components whose records are untouched.

## What this repository contains

It started as the PoC milestone from the implementation brief — taking `.tsx` source all the way to a validated GraphQL operation and a Suspense-aware runtime — and has since grown the write side (`useMutation`), fine-grained reactivity, and the RedwoodSDK + React Router integrations, each end-to-end with tests.

> [!NOTE]
> An app installs **two** packages: `@gleanql/client` (runtime) and `@gleanql/vite` (build plugin). The rest are internal building blocks.

<div class="cards">
  <div class="card"><h3>@gleanql/client</h3><p>The runtime you install: cache, Suspense, graph proxies, request scope, transports, the React hooks — plus a <code>generated/</code> slot for the schema.</p><a href="/runtime">Read →</a></div>
  <div class="card"><h3>@gleanql/vite</h3><p>The build plugin: provisions <code>@gleanql/client</code>, runs codegen + the compiler, and writes the <code>glean</code> accessor / types / operations into it.</p><a href="/vite">Read →</a></div>
  <div class="card"><h3>@gleanql/core</h3><p>Query IR, the <code>q.*</code> builder, the selection merger, the GraphQL printer, schema model, devtools.</p><a href="/core">Read →</a></div>
  <div class="card"><h3>@gleanql/compiler</h3><p>Backend seam + a <code>typescript</code> backend, and the analyzer that extracts reads &amp; prop flow.</p><a href="/compiler">Read →</a></div>
  <div class="card"><h3>@gleanql/codegen</h3><p>Introspection → the <code>SchemaModel</code>, branded TS types, and the <code>glean</code> accessors.</p><a href="/codegen">Read →</a></div>
</div>

## Quick start

Head to [Get started](get-started.md) — install two packages, point the plugin at your schema, write a component. The build gives you one compiled operation per route, a typed accessor, a normalized reactive cache, a persisted-operation allowlist, and the `/__glean` devtools page.

> [!NOTE]
> **Three real, bootable examples.** `examples/rwsdk-real` is a genuine RedwoodSDK app (React 19 RSC on workerd) demoing persisted mode, registered operations, live subscriptions and the event channel; `examples/rwsdk-todo` is TodoMVC on a SQLite Durable Object with optimistic membership; `examples/remix-real` is the same data layer on React Router 7 (isomorphic SSR — not RSC), proving the framework binding is pluggable. None commit any graph glue.

Working on GleanQL itself? `pnpm install && pnpm test` runs the full suite (~400 tests: golden fixtures through two type-checker engines, runtime, adapters, codegen, the build plugin); `pnpm typecheck` covers every package against one root tsconfig.

## How it fits together

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

To build with it, head to [Using GleanQL](usage.md) — a task-oriented tour (read, mutate, paginate, subscribe, optimistic UI). To see how this compares to the alternatives, read [vs Relay & gqty](comparison.md). For the internals, continue to [Architecture & pipeline](architecture.md) for the worked example, or jump to a page on the left.

---

GleanQL — TypeScript-Native GraphQL Query Compiler — ~400 tests, type-clean. Generated operations are validated against the real schema with graphql-js.
