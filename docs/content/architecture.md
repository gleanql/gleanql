---
title: Architecture & pipeline
group: Guide
order: 5
---

# Architecture & pipeline

From `.tsx` source to a validated GraphQL operation, step by step — and why the responsibilities are split the way they are.

## Responsibility split

The system owns everything *about* the data graph; an existing client owns the wire.

| This system owns | A client/transport adapter owns |
| --- | --- |
| field-read extraction · selection/path model · operation generation · de-duping · batching · read maps · graph value runtime · Suspense/cache behavior · normalization/invalidation | HTTP transport · auth headers · request cancellation · retries · the subscription stream (SSE in-box, or graphql-ws) · network-level persisted queries |

## The packages

| Package | Responsibility |
| --- | --- |
| `@gleanql/core` | Query IR, `q.*` builder, selection merger, GraphQL printer, schema model, operation artifact, devtools, fluent escape hatch. |
| `@gleanql/compiler` | `GraphCompilerBackend` seam, a `typescript` backend, and the analyzer. |
| `@gleanql/client` | Client adapter, normalized/path cache, normalizer, Suspense runtime, route seam, and the React glue factories (`createGraphClient`/`createGraphServer`) the generated entrypoints shim over (`react` peer, `>=18`). |
| `@gleanql/vite` | The build plugin: generates the schema (`glean` accessor, types, operations) into `@gleanql/client`. Framework-specific decisions sit behind a `FrameworkPreset` seam; the core pipeline stays neutral. |

## The compile pipeline

```flow
1. discover   route entrypoints (functions that call glean.<root>) + components
2. anchor     each glean.product({…}) → a root field on the Query selection,
              arguments lifted into a variables factory
3. flow       follow JSX props: <ProductHero product={product} /> binds the
              child's `product` param to the same selection node
4. read       property/optional/alias/destructure/call reads attach fields to
              the mutable selection tree; leaf reads also land in the read map
5. normalize  core merger: dedupe by canonical path, alias arg-conflicts,
              inject __typename/id, order deterministically
6. print      core printer → GraphQL document (+ hash, stats)
7. emit       OperationArtifact { document, variablesFactory, readMap, … }
```

## Worked example

Two components read different parts of the same `product`. Each contributes a partial selection; the merger combines them.

**ProductHero reads**

```tsx
Product.title
Product.featuredImage.url
```

**BuyBox reads**

```tsx
Product.priceRange
       .minVariantPrice.amount
Product.priceRange
       .minVariantPrice.currencyCode
```

The analyzer connects the root call to both components and emits one merged operation:

```graphql
Query.product(handle: params.handle)
  ├─ ProductHero reads
  └─ BuyBox reads
        ▼  (one operation)
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

## Compiler vs. runtime authority (hybrid)

The compiler is authoritative for the *initial* operation; the runtime may fetch fields that were not statically reachable (lazy/dynamic paths). The mode is configurable:

| Mode | Behavior |
| --- | --- |
| `hybrid` v1 default | compiled query first; runtime misses allowed, warned in dev. |
| `strict` | compiled query only; an unexpected runtime miss throws. |
| `runtime-first` | runtime tracking is the source of truth; the compiler is an optimization. |

v1 implements `hybrid` and exposes `unexpectedMissingField: "allow" | "warn" | "error"` on the runtime to select the others.

## The backend seam

The analyzer walks the TypeScript AST for *structure* but routes every *type/symbol* question through `GraphCompilerBackend`. The default ships a real `ts.Program` + `TypeChecker`. Because the seam is the only contact point for type info, a Go-based engine (tsgo / `@typescript/native-preview`) plugs in without touching analysis logic — it already does, as an experimental `backend` option.

```tsx
interface GraphCompilerBackend {
  getSourceFile(fileName): ts.SourceFile | undefined;
  getGraphTypeNames(node): readonly string[] | undefined; // union → many
  getGraphTypeName(node): string | undefined;
  isGraphBackedType(node): boolean;
  resolveDeclaration(node): ts.Declaration | undefined;
}
```

The build creates **one** `ts.Program` over all files and analyzes each route against it (`analyzeFile` + a shared backend), instead of recreating a full program per route — O(routes × files) program builds collapse to one. Because all type/symbol queries still go through the seam, the engine stays swappable: the in-process `typescript` backend is the default, and an experimental Go-native `tsgo` backend (`@typescript/native-preview`) is selectable via the Vite plugin's `backend` option — same interface, much faster type-checking on large route sets, with a graceful fallback to `typescript` when the optional dep can't be resolved.

---

Next: [@gleanql/core](core.md) — the IR, merger, and printer that turn extracted reads into a document.
