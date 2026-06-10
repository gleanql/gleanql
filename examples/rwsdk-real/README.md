# Real RedwoodSDK app driven by GleanQL

A genuine [RedwoodSDK](https://rwsdk.com) worker (React 19 RSC on Cloudflare /
workerd) using the monorepo's GleanQL data system. Ordinary server components
read `graph.product({ handle }).title` etc.; the compiled operation runs against
an in-memory GraphQL server (graphql-js) through the **urql adapter**, seeds the
cache, and the components render — no GraphQL in app code.

## Run it

It's a pnpm workspace member, so install from the repo root, then run the app:

```bash
pnpm install                      # from the repo root
pnpm --filter @example/rwsdk-real dev
# or: cd examples/rwsdk-real && pnpm dev
```

- `/` → redirects to `/collections/all`
- `/collections/all` → a **list route**: `graph.collection(...).products({ first }).nodes.map(...)` over a `<ProductCard>` in its own file
- `/products/:handle` → a **detail route**: `<ProductHero>` + `<BuyBox>`, each in its own file
- unknown handle → 404

Two routes → two separate compiled operations; components split across files →
the compiler follows the imports and merges each component's reads into its
route's operation.

## No committed graph glue

You write only your **schema**, **routes/pages/components**, and **transport**:

```
schema.graphql                 # the GraphQL schema
src/app/pages/*.tsx            # routes (read graph fields)
src/app/components/*.tsx       # components, split across files
src/graph-server.ts           # the transport (here: in-memory graphql-js)
src/worker.tsx                # defineApp + routes + preload interruptor
vite.config.mts               # one line: graph({ schema, routes })
```

There is **no graph glue in the app at all** — no plugin file, no tsconfig paths,
no setup script. You install two packages — **`@gleanql/client`** (the runtime) and
**`@gleanql/vite`** (the build plugin, a devDep). On startup the plugin:

1. provisions `@gleanql/client` into `node_modules` (RedwoodSDK's directive scanner
   requires modules inside the app root);
2. runs `@gleanql/codegen` from `schema.graphql` → `SchemaModel` + branded types;
3. compiles the route files with `@gleanql/compiler` → operations;
4. writes the generated `graph` accessor + types + `operations` into
   **`@gleanql/client/generated`**, and a top-level barrel + `package.json` `exports`.

So `import { graph } from "@gleanql/client"` and `import type { Product } from
"@gleanql/client/schema"` resolve by ordinary node resolution — **no tsconfig
`paths`, no vite `alias`**. The user's entire setup is: install the two packages,
add `graph({ schema, routes })` to `vite.config.mts`, and import from `@gleanql/client`.

```ts
// vite.config.mts
import { graph } from "@gleanql/vite";
export default defineConfig({
  plugins: [graph({ schema: "schema.graphql", routes: ["src/app/pages/ProductPage.tsx", "src/app/pages/CollectionPage.tsx"] }), cloudflare(), redwood()],
});
```

## How a request flows

A route **interruptor** calls `integration.preload(requestInfo)` (executes the
operation, seeds a fresh per-request cache, attaches the bound graph to `ctx`);
RedwoodSDK renders the page, whose `graph.product(...)` reads resolve against that
cache (`@gleanql/app` resolves the active runtime from `requestInfo.ctx`).

> A pnpm workspace member: it depends on `@gleanql/rwsdk-vite` via `workspace:*`
> (excluded from the root tsconfig so the monorepo typecheck stays focused on the
> core packages). Published, you'd `npm i @gleanql/rwsdk-vite` instead — the import
> and everything downstream is identical.
