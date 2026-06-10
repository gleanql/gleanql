---
title: Using GleanQL
group: Guide
order: 3
---

# Using GleanQL

A task-oriented tour: install it, read data, write data, paginate, subscribe, and do optimistic UI — all without writing a single GraphQL document. The rule throughout: **a field access is a data requirement**. You read fields like normal object properties; the compiler turns those reads into one operation per route.

## 1 · Install & wire up

An app installs two packages — the runtime and the build plugin. Everything else is internal.

```bash
# the runtime you import from, and the Vite plugin that generates into it
pnpm add @gleanql/client @gleanql/vite
```

Add the plugin to `vite.config.ts`, pointing it at your schema SDL. The `framework` binding defaults to `"rwsdk"` (set `"react-router"` otherwise). It runs codegen + the compiler and writes the generated `glean` accessor, types, and operations into `@gleanql/client`; routes and selector-hook islands are auto-discovered:

```tsx
import { glean } from "@gleanql/vite";

export default {
  plugins: [glean({ schema: "schema.graphql" })], // framework: "rwsdk" (default) | "react-router"
};
```

Now `@gleanql/client` exposes a typed `glean` accessor (one callable per Query root) and, for `"use client"` islands, the `@gleanql/client/client` hooks. Schema types are importable as plain TS types. See [@gleanql/vite](vite.md) and the [RedwoodSDK](rwsdk.md) / [React Router](react-router.md) integration pages for the per-framework wiring.

## 2 · Read data

Open a root with the accessor and read fields off it like any object. The reads, followed across the whole route (including through JSX props into child components), *become* the operation:

```tsx
import { glean } from "@gleanql/client";
import type { Product } from "@gleanql/client/schema";

export default function ProductRoute({ params }) {
  const product = glean.product({ handle: params.handle }); // root call → a $handle variable
  return <><Hero product={product} /><BuyBox product={product} /></>;
}

function BuyBox({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice; // nested reads fold in too
  return <button>{price.amount} {price.currencyCode}</button>;
}
```

The compiler de-dups the reads across `Hero` + `BuyBox` and emits a single `query ProductRoute($handle: String!) { product(handle: $handle) { … } }` plus a variables factory. At runtime a read hits the warm cache; a field absent from the seed suspends and is batch-fetched. No `select` blocks, no fragments, no `ProductRef` — userland types look like schema types.

> [!NOTE]
> **Root arguments become variables.** `glean.product({ handle: params.handle })` lifts `handle` into `$handle` with a generated factory; a transformed local (`const h = params.handle.toLowerCase()`) is reproduced in the factory too.

## 3 · Server components vs. islands

A server component reads through the isomorphic `glean` accessor (above). A `"use client"` **island** reads through the `useGlean()` hook — its reads still fold into the owning route's operation at compile time, so it hydrates warm:

```tsx
"use client";
import { useGlean } from "@gleanql/client/client";

export function Availability({ handle }: { handle: string }) {
  const glean = useGlean();             // re-renders fine-grained as the cache changes
  const product = glean?.product({ handle });
  return <span>{product?.availableForSale ? "In stock" : "Sold out"}</span>;
}
```

An island re-renders only when a record *it* read changes (per-field tracking), and again on hydration/navigation so it re-resolves the page's roots. See [@gleanql/client](runtime.md) for the reactivity model.

## 4 · Lists & list roots

Map over a list field or a top-level list root; the element reads fold into the op. A list root (`type Query { todos: [Todo!] }`) needs no wrapper:

```json
{glean.todos().map((todo) => (
  <li key={todo.id}>{todo.title}</li>  // id + title fold into  todos { id title }
))}
```

## 5 · Write data (mutations)

Mutations compile the same way — a gqty-style selector defines the operation; the build injects its name. The result normalizes into the cache, so every reader of the mutated entity updates *in place*:

```tsx
import { useMutation } from "@gleanql/client/client";

const [toggle, { isLoading }] = useMutation((m, vars: { id: string }) => m.toggleTodo(vars).completed);

await toggle({ id });  // server returns the entity → its `completed` flips wherever it's shown
```

A selector can pull several fields back by returning an array/object of reads (`(m, vars) => { const t = m.addTodo(vars); return [t.id, t.title, t.completed]; }`). The hook returns `[mutate, state]` with `data`/`error`/`userErrors`; it never rejects for logical failures.

## 6 · Optimistic UI

For a snappy add/remove, update the UI before the server responds. Field changes use `optimistic` (cache writes, auto-rolled-back); list *membership* uses `optimisticRoots` (auto-rolled-back). Generate the id client-side so the optimistic row is the final row — the mutation normalizes over the same identity, nothing to reconcile:

```tsx
const [add] = useMutation(selector, {
  optimisticRoots: (roots, vars) =>
    roots.append("todos", { __typename: "Todo", id: vars.id, title: vars.title, completed: false }, { prepend: true }),
});

await add({ id: crypto.randomUUID(), title }); // row appears now; rolls back if the mutation fails
```

Or splice membership directly with `appendToRoot` / `removeFromRoot` for a post-confirmation update. Details in [@gleanql/client → List-root membership](runtime.md).

## 7 · Paginate

Read a connection in render, then `usePaginated` gives you a `fetchMore` that re-runs that connection's selection with your cursor args and merges the page (default: concat `nodes`). No convention is assumed — you read `pageInfo`/cursors yourself, so exactly what you use is fetched:

```tsx
const products = glean.collection({ handle }).products({ first: 20 });
const { fetchMore, isLoading } = usePaginated(products);

// onClick: await fetchMore({ first: 20, after: products.pageInfo.endCursor });
```

## 8 · Live data (subscriptions)

A `useSubscription` selector roots at the `Subscription` type and compiles like a mutation. Each pushed payload normalizes into the cache, so readers re-render fine-grained:

```tsx
const { data } = useSubscription((s, vars: { handle: string }) => s.productChanged(vars).price, {
  variables: { handle },
});
```

The in-box fetch adapter streams subscriptions over Server-Sent Events; for WebSockets, pass a `graphql-ws` client to `createGraphWsAdapter` — same seam, no compile or hook changes.

## 9 · Refetch

`refresh()` re-runs the current page's operation over the wire and re-seeds the cache (reconciled by identity, so only changed fields re-render). Use it after a change that doesn't return the affected entities — e.g. a bulk update returning a count:

```tsx
import { refresh } from "@gleanql/client/client";
await refresh();                 // whole page op
await refresh({ component: "Views" }); // just one component's read-slice
```

## 10 · Lock down the wire (persisted operations)

The build compiled every operation the app can send, so the server can refuse anything else. Turn it on in one place — the client then sends only sha-256 hashes (the APQ wire shape), never documents:

```tsx
// vite.config.ts
glean({ schema: "./schema.graphql", persisted: true });

// your /graphql endpoint (same deploy: feed it the generated operations map)
import { createPersistedResolver, operations } from "@gleanql/client";
const resolve = createPersistedResolver(operations);

const r = resolve(body);
if (r.kind === "not-found") return json({ errors: [{ message: "PersistedQueryNotFound" }] });
if (r.kind === "rejected")  return json({ errors: [{ message: "Not allowed" }] }, 400);
return json(await execute(r.document, body.variables));
```

For a separately-deployed GraphQL server, sync the build-emitted `generated/persisted.json` (hash → document) instead. Working end-to-end in `examples/rwsdk-real`.

## 11 · Hand-built operations (dynamic shapes)

The compiler covers reads it can see. For a shape it can't extract — a report whose selection your code composes — build the IR by hand and **register** it: the build prints + hashes it and ships it like a compiled operation (same generated map, same persisted allowlist, same `/__glean` page).

```tsx
// src/report-operations.ts — exports are OperationIR (run AT BUILD TIME)
import { buildQuery } from "@gleanql/core";

export const Report = buildQuery("Report", { handle: "String!" }, (root, $) => ({
  product: root.product({ handle: $.handle }, (p) => ({ title: p.title, vendor: p.vendor })),
}));

// vite.config.ts
glean({ schema, operations: "./src/report-operations.ts" });

// anywhere at runtime — executes by name, seeds the normalized cache
import { runOperation } from "@gleanql/client/client";
const result = await runOperation("Report", { handle });
```

**Fully typed:** the build renders a `GleanOperations` interface from every operation's selection + variable definitions, so `runOperation("Report", …)` checks the variables and infers the result shape — no hand-written types, no casts.

> [!NOTE]
> **The boundary:** the module runs at *build* time, so the shape must be deterministic then (the variables stay runtime-dynamic). A selection composed from *user input at runtime* can't be allowlisted by definition — for that, keep a separate endpoint or `allowUnpersisted`.

## 12 · Handle errors

Each surface has one error channel — nothing is swallowed:

| Surface | What you get |
| --- | --- |
| Route preload (server) | `runRoute`/`integration.preload` return `errors` alongside `roots`; a missing root is your 404 branch (see the examples' `preload()`). |
| Reads (`useGlean`) | a cache miss suspends; if the batched `fetchMissing` *fails*, the suspended promise rejects — a React **error boundary** around the route/island catches it. `unexpectedMissingField: "warn" \| "error"` turns silent misses into console warnings or throws. |
| `useMutation` | `[mutate, state]` — transport/GraphQL failures land in `state.error`; LOGICAL failures (your schema's `userErrors`) land in `state.userErrors`. `await mutate(vars)` never rejects on logical failures; optimistic writes roll back automatically. |
| `useSubscription` | `{ data, error }` — a dropped stream surfaces as `error`; the SSE transport auto-reconnects and keeps the stream open. |
| `refresh()` / `fetchMore()` | returned promises reject on transport failure — `await` them where you trigger them. |
| Transport | a non-JSON response (proxy 502 HTML) throws a clear `graph fetch: non-JSON response…` error instead of a JSON parse error; GraphQL `errors` always ride the result. |

> [!NOTE]
> **Rule of thumb:** one error boundary per route + one per island. Reads inside either suspend (loading) or reject into the boundary (failure); writes report through their hook state instead of throwing.

## Where to go next

- [@gleanql/client](runtime.md) — the runtime: cache identity, reactivity, hooks, adapter, mutations.
- [@gleanql/compiler](compiler.md) — what the analyzer folds (reads, prop flow, lists, unions, list/mid-chain roots).
- [RedwoodSDK](rwsdk.md) / [React Router](react-router.md) — per-framework setup.
- [API reference](api.md) — the full exported surface.
- [Golden cases](golden-cases.md) — the behavior catalog (input.tsx → operation).

---

A field access is a data requirement — write components, get one operation per route.
