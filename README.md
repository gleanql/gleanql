# Glean

**GraphQL without writing GraphQL.** You write plain React components — Glean's
compiler reads them at build time and figures out the queries for you.

```tsx
const product = glean.product({ handle: params.handle });

function BuyBox({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  return <button>{price.amount} {price.currencyCode}</button>;
}
```

That's the whole data layer. No queries, no fragments, no `useQuery` wrappers.
Glean compiles those field reads into **one GraphQL operation per route**, and
gives you a normalized cache, optimistic mutations, live subscriptions, and
persisted operations on top.

## Why?

GraphQL clients make you choose:

- **Relay** gives you great runtime performance, but you declare your data
  twice — once in JSX, once in fragments.
- **gqty** lets you skip the queries, but it discovers them *at runtime* — so
  you get proxy magic, request waterfalls, and nothing to persist.

Glean takes the third path: **declare once, resolve at build time.** You get
gqty's developer experience with Relay's runtime characteristics. The longer
version (with an honest feature matrix) is in the docs: `pnpm docs` →
**/comparison**.

## What's in the box

- ⚡ **One compiled operation per route** — reads are followed through props,
  helpers, `.map` callbacks, and `"use client"` islands. If the compiler can't
  follow something, that's a build error — never a silent under-fetch.
- 🔁 **Live recompilation** — add a field read, the operation updates while the
  dev server runs.
- 🧠 **Normalized reactive cache** — field-level re-rendering, Suspense-aware
  reads, smart memory (reference-counted retention + opt-in staleness GC).
- ✍️ **Mutations & live data** — compile-time `useMutation` with optimistic
  updates and auto-rollback, `useSubscription` over SSE or `graphql-ws`.
- 🔒 **Persisted operations** — every build emits a sha-256 allowlist; flip
  `persisted: true` and only known hashes ride the wire.
- 🛠 **Devtools** — open `/__glean` in dev to see every operation, its hash,
  and exactly which component reads which field.
- 📊 **Typed escape hatch** — hand-build operations for dynamic shapes
  (reports, dashboards) and run them by name, fully typed.

## Get started

```ts
// vite.config.ts
import { glean } from "@gleanql/vite";

export default defineConfig({
  plugins: [glean({ schema: "./schema.graphql" }), redwood()],
});
```

Then write components. The docs walk the full path (install → first component
→ devtools): `pnpm docs` → **/get-started**. Works with **RedwoodSDK** (React
Server Components) and **React Router 7** (isomorphic SSR) today.

> **Pre-release:** the `@gleanql/*` packages aren't on npm quite yet — run from
> this repo for now. The examples below are complete apps.

## See it running

| App | What it shows |
|---|---|
| [`examples/rwsdk-real`](examples/rwsdk-real) | A storefront on RedwoodSDK: islands, live SSE prices, mutations, the persisted allowlist, a typed registered operation |
| [`examples/rwsdk-todo`](examples/rwsdk-todo) | TodoMVC on a SQLite Durable Object: optimistic add/remove with auto-rollback |
| [`examples/remix-real`](examples/remix-real) | The same data layer on React Router 7 — no RSC required |

## Packages

| Package | What it does |
|---|---|
| [`@gleanql/vite`](packages/vite) | The build plugin — the only wiring an app needs |
| [`@gleanql/client`](packages/client) | The runtime — cache, hooks, transports |
| [`@gleanql/core`](packages/core) | Operation IR, merger, printer, schema model |
| [`@gleanql/compiler`](packages/compiler) | The static analyzer that turns components into operations |
| [`@gleanql/codegen`](packages/codegen) | Schema → typed accessor + branded types |

## Working on Glean

```
pnpm install
pnpm test        # ~400 tests, incl. golden fixtures through two type-checker engines
pnpm typecheck
pnpm docs        # the docs site (markdown in docs/, RedwoodSDK reader in site/)
```

CI builds and typechecks every package, every example app, and runs a
pack→install→generate e2e that proves the published packages work standalone.

See [CHANGELOG.md](CHANGELOG.md) for what's in 0.1.0, and the docs'
**/decisions** page for the design rationale.

## License

[MIT](LICENSE)
