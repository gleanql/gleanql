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
