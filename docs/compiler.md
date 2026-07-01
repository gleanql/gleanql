---
title: @gleanql/compiler
group: Packages
order: 10
---

# `@gleanql/compiler`

The compiler type-analyzes React/TypeScript source. It follows prop flow and extracts the graph read paths that become the operation. Every type question goes through a swappable backend seam.

## Entry points

```tsx
// one-shot convenience (builds a backend, analyzes one file)
analyzeWithTs({ fileName, supportDir, schema }) → AnalyzeResult

// long-lived backend (used by the Vite plugin)
const backend = new TsBackend({ fileNames, supportDir });
analyzeFile({ fileName, backend, schema }) → AnalyzeResult

interface AnalyzeResult {
  operations: readonly OperationArtifact[]; // one per route entrypoint
  readMap: ReadMap;                       // merged across the file
  diagnostics: readonly Diagnostic[];
}
```

## How graph types are recognized

A type is graph-backed if it has a literal `__typename` property. That property is genuinely the GraphQL `__typename` of an object. Userland types are therefore plain interfaces, with no special brand symbol:

```tsx
interface Product {
  __typename: "Product";   // ← the brand the backend reads
  id: string; title: string; featuredImage: Image | null; …
}
type SearchResultItem = Product | Collection; // union → ["Product","Collection"]
```

The `TsBackend` reads the literal(s) via a real `ts.TypeChecker`. A union yields multiple names, which are used for `__typename` narrowing. Field *types* for nested walking come from the schema model. The schema model is authoritative about list-ness, arguments, and identity.

Every type/symbol question goes through `GraphCompilerBackend`, so the engine is swappable. `createBackend("typescript", …)` builds the in-process `TsBackend`. An *experimental* Go-native engine ships behind the same seam: `createTsgoBackend(…)` drives the same `analyzeFile` walker over `@typescript/native-preview`'s AST + checker, via an engine-agnostic `AstFacade`. That dependency is optional and dynamically imported, since it is pre-release. The [Vite plugin](vite.md) selects between the engines with `backend: "typescript" | "tsgo"`. It falls back to `typescript` if tsgo can't be resolved.

## The analyzer

```flow
indexComponents     top-level functions / arrow consts with a graph-typed param
indexRegistries     module-level `const x = glean.components({…})`
─ for each route (component containing glean.<root>) ─
  createRoot        glean.product({…}) → root field; args → variables factory
  walkStatement     bindings, if-narrowing, returns
  evalExpr          property/optional/element/call chains → GraphValue, records reads
  handleJsx         resolve component(s), bind graph props, recurse
─ standalone components (graph props, not reached by a route) ─
  read map + diagnostics only
```

A **GraphValue** carries four things:

- the current GraphQL type
- the mutable selection node new reads attach to
- a list flag
- a read-map base/path

Entering a component or a list-iteration callback resets the read-map base to the new entity type. That reset is why `filter((p) => p.availableForSale)` records `Product.availableForSale`, not the full `Collection.products.nodes…` path.

## Supported subset (v1)

| Pattern | Example |
| --- | --- |
| direct prop flow | `<ProductCard product={product} />` |
| cross-file components | imported components resolved via `tsconfig` aliases (`@/…`) or relative paths |
| local helper functions | `summary(product)` → reads inside `summary`'s body are tracked |
| property & optional chaining | `product.featuredImage?.url` |
| aliases | `const image = product.featuredImage; image?.url` |
| destructuring | `const { title, featuredImage } = product` |
| scalar method calls | `product.title.toUpperCase()` → reads `title` |
| object truthiness | `if (!product.featuredImage)` → `featuredImage { __typename }` |
| callable fields | `collection.products({ first: 12 }).nodes` |
| arg conflicts → aliases | `products({first:12})` & `products({first:24})` |
| lists | `.map` / `.filter` / `.find` / `nodes[0]` |
| static dynamic component | `const C = cond ? ProductCard : ProductRow` |
| component registry | `glean.components({ card, row })[view]` |
| union narrowing | `if (node.__typename === "Product")` → inline fragments |
| multiple roots | batched into one operation |
| list root | `glean.products().map(…)` — a top-level `[Product!]` root, no object wrapper |
| mid-chain root | `glean.board().todos` — the root is created mid-expression, not only when bound |
| lazy boundary | `<GraphLazy>…</GraphLazy>` excluded from the initial op |

## Variables & argument capture

The compiler lifts root-call arguments into operation variables and a generated factory.

**Simple — a pure context path**

```tsx
glean.product({ handle: params.handle })

// $handle; factory returns ctx.params.handle
export function getProductRouteVariables(ctx) {
  return { handle: ctx.params.handle };
}
```

**Complex — transformed / lifted**

```tsx
const handle = params.handle.toLowerCase();
glean.product({ handle });

// $product_handle; factory reproduces the local
export function getProductRouteVariables(ctx) {
  const handle = ctx.params.handle.toLowerCase();
  return { product_handle: handle };
}
```

**Render-time ("two-sweep") — args computed during render**

When a root arg references an *in-render* binding (or a module import) — anything
not derivable from route params/context — the value isn't known at preload time,
so it can't go in the `ctx` factory. The compiler keeps the `$var` in the
document, marks the operation `deferred`, and **omits the var from the factory**;
the runtime executes that root at the read call-site with the value the read
proxy already receives, then seeds the cache (Suspense). This is the "two-sweep"
pattern — fetch your own data first, then GraphQL keyed by it:

```tsx
export default async function Bookings() {
  const services = await listServices();              // sweep 1: your DB
  const ids = services.map((s) => s.productId);
  const products = await glean.nodes({ ids });        // sweep 2: glean, runtime args
  products.forEach((n) => {
    if (n.__typename === "Product") { /* n.title, n.featuredMedia… */ }
  });
}

// $nodes_ids stays in the document; the factory is empty (no ctx entry):
export function getBookingsVariables(ctx) {
  return {};
}
```

**`await` the deferred read in an `async` component.** A deferred root read is
resolved either synchronously (throwing a Suspense promise) or by `await`ing it —
but a synchronous read thrown from inside an `async` component makes React
re-invoke the component, which throws again → an infinite retry that burns the
whole CPU budget (a blank page / "exceeded CPU time" in production). `await
glean.nodes({ ids })` resolves cleanly with no throw. The synchronous form is only
for a **non-`async`** component, where a real Suspense boundary catches the throw
and re-renders. The compiler traces the field reads through the `await` either way,
so the compiled operation is identical — and it **flags the un-awaited case at build
time** (`unawaited-deferred-read`), so you never ship the loop to production.

`ctx` is simply the variable source known *before* render; the render scope is the
source known *during* it. Both are first-class. (The `__typename` narrowing is
independent of where the args come from — see [Interfaces & unions](#interfaces--unions).)

A deferred root is **isomorphic** — the same call site works in a React render and
in a plain (non-React) server handler (webhook, job, proxy, API route). In a
synchronous (non-`async`) component it reads synchronously (Suspense); in an
`async` component or a plain handler you `await` it (see the note above) — no
`runRoute`, no raw `graphql()`:

```tsx
// React / RSC — reads synchronously, suspending until the fetch + seed land:
glean.order({ id }).name

// Server handler — `await` the same call; resolves instead of suspending:
const order = await glean.order({ id });   // object root → a graph value
order.name;                                // cache hit (seeded by the fetch)
const products = await glean.nodes({ ids }); // list root → a real array
```

Both paths go through the one deferred executor and share the request cache, so an
`await` and a concurrent Suspense read of the same root+args dedupe to a single
fetch. The runtime primitive is a pair — `runtime.resolveRoot` (sync, throws a
Suspense promise) and `runtime.resolveRootAsync` (async, resolves) — and the bound
graph exposes a deferred root as a value that is both directly readable and
awaitable. See [runtime → Reads outside React](runtime.md#reads-outside-react-await).

The compiler sees through the `await` (like `(expr)` and `expr!`) to follow the
reads on the resolved value, so `const o = await glean.order({ id }); o.name` and
the un-awaited form compile identically. Two constraints, same as any read: **read
where the root is read** — put the `glean.x()` call in the handler (a call-site
argument is what makes it deferred), and hand a reshaping helper the resolved graph
*value* (`format(o)`), never the id (`format(id)` reads nothing the compiler can
follow, so it can't trace the fields). And prefer `list.map(…)` over `(list ?? [])
.map(…)`: the `?? []` hides the list behind an expression the map-flow doesn't
descend, dropping the callback's reads.

## Dynamic components (tiers)

| Tier | Handling |
| --- | --- |
| 1 · static conditional | `cond ? A : B` — include the *union* of both components' reads. |
| 2 · typed registry | `glean.components({…})[key]` — merge all members' reads (or one if `key` is a literal). |
| 3 · lazy registries | read manifests per module (deferred in v1). |
| 4 · truly unknown | `<Component />` from a prop — diagnostic. |

## Interfaces & unions

A `node.__typename === "Product"` guard narrows the union. The analyzer emits inline fragments for the narrowed branches. Fragments are generated internally, never authored by hand.

```tsx
nodes {
  __typename
  ... on Product { __typename id title featuredImage { __typename url } }
  ... on Collection { __typename id title image { __typename url } }
}
```

## Lazy boundaries

By default, statically reachable fields are eager — even behind conditionals. To defer reads, wrap them in `<GraphLazy>`. Reads inside the boundary are excluded from the initial operation. They fall through to a runtime fetch when the boundary renders.

## Diagnostics

Unsupported patterns produce clear, actionable messages. The messages are part of the golden output.

| Code | Trigger |
| --- | --- |
| `dynamic-field-access` | `product[fieldName]` |
| `unresolved-dynamic-component` | `<Component />` that can't be statically resolved |
| `graph-value-spread` | `{ ...product }` |
| `recursive-component` | a component that renders itself with a graph prop |

---

Next: [@gleanql/client](runtime.md) — seeding, Suspense, batching, hydration.
