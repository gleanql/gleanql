---
title: Get started
group: Guide
order: 2
---

# Get started

From zero to a compiled, cached, persisted GraphQL page in five steps. You will not write a single GraphQL document.

## 1 · Install

Two packages: the runtime your app imports, and the build plugin that generates everything into it.

```bash
pnpm add @gleanql/client
pnpm add -D @gleanql/vite
```

> [!NOTE]
> **Pre-release note:** until the first npm release lands, run GleanQL from the monorepo (clone + `pnpm install`; the examples show the full setup).

## 2 · Point the plugin at your schema

One plugin, one required option. Everything else — codegen, the compiler, the typed accessor, the persisted manifest — happens behind it on every build and dev start.

```tsx
// vite.config.ts (RedwoodSDK)
import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { glean } from "@gleanql/vite";

export default defineConfig({
  plugins: [glean({ schema: "./schema.graphql" }), redwood()],
});
```

On React Router 7 (isomorphic SSR, no RSC), add the framework + a shared scope module — the [React Router page](react-router.md) shows the three-file setup:

```tsx
glean({ schema: "./schema.graphql", framework: "react-router" })
```

## 3 · Write a component — field access is the query

```tsx
import { glean } from "@gleanql/client";
import type { Product } from "@gleanql/client/schema";

export function ProductPage({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main>
      <h1>{product.title}</h1>
      <BuyBox product={product} />
    </main>
  );
}

function BuyBox({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  return <button>{price.amount} {price.currencyCode}</button>;
}
```

The compiler follows the reads — through props, helpers, `.map` callbacks, islands — and emits **one operation for the route**, a variables factory bound to your route params, and a per-component read map. Anything it can't follow is a *build error*, never a silent under-fetch.

## 4 · Run it

```bash
pnpm dev
```

Open your route — the page renders server-side from one compiled operation and hydrates with the cache warm. Then open **`/__glean`**: every operation the build compiled, its document, persisted hash, size stats, and which component reads which field. That page is the complete picture of what your app can put on the wire.

## 5 · Turn the production knobs (when you want them)

```tsx
glean({
  schema: "./schema.graphql",
  persisted: true,        // hash-only wire + server allowlist
  gcKeepPages: 2,         // collect cache records stale for 2 navigations
  maxCacheRecords: 5000,  // LRU capacity bound
  strict: true,           // any compiler diagnostic fails the build (CI)
  operations: "./src/report-operations.ts", // hand-built shapes, allowlisted too
});
```

Each knob is documented on the [@gleanql/vite page](vite.md); none are required to start.

## Where next

- [Using GleanQL](usage.md) — the task tour: mutations, optimistic UI, pagination, subscriptions, errors.
- [vs Relay & gqty](comparison.md) — why "declare once, resolved at build time" is a different animal.
- `examples/rwsdk-real`, `examples/rwsdk-todo`, `examples/remix-real` — three bootable apps exercising everything above.
