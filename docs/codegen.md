---
title: @gleanql/codegen
group: Packages
order: 11
---

# `@gleanql/codegen`

Schemas are not hand-authored. Point the generator at a GraphQL introspection result. It emits the three files the rest of the system consumes — the machine-generated equivalents of what you'd otherwise write by hand.

## Inputs & outputs

| Output | What it is |
| --- | --- |
| `schema-model.ts` | the `SchemaModel` the compiler + runtime read (root fields, identity, lists, callable fields, union possible-types) |
| `schema.ts` | branded TS types — literal `__typename`, accurate nullability/lists, callable fields as methods, enums/unions/interfaces/inputs |
| `graph.ts` | the `glean.product({ handle })` accessors + `components(...)` |

## Usage

```tsx
import { introspectionFromSchema, buildSchema } from "graphql"; // or your live introspection
import { generateSchemaPackage } from "@gleanql/codegen";

const { schemaModel, types, graph } = generateSchemaPackage(
  introspectionFromSchema(buildSchema(sdl)).__schema,
  { scalarTypes: { DateTime: "string", Decimal: "string" } }, // custom scalars
);
// write schemaModel → graph/schema-model.ts, types → graph/schema.ts, graph → graph/graph.ts
```

## Why branded types

To app code these read as ordinary schema types. The compiler recognizes them via the `__typename` brand. Nullability and lists are rendered exactly, so TypeScript catches API drift before runtime:

```tsx
export interface Product {
  __typename: "Product";
  title: string;                 // String!  → non-null
  descriptionHtml: string | null; // String   → nullable
  featuredImage: Image | null;
  images(args: { first: number }): Image[]; // [Image!]! + field args → callable
}

// product.title now fails to compile if the API drops or renames `title`.
```

## Loop closure

The generator is decoupled from graphql-js. It transforms the introspection JSON, using structural types. The whole loop is verified end-to-end in `examples/storefront/codegen.test.ts`:

- a GraphQL schema produces the generated `SchemaModel`
- the *real* compiler runs on `ProductRoute.tsx` against that model
- the output is the byte-identical acceptance operation

---

Back to [Overview](index.md) · how the model is used: [@gleanql/compiler](compiler.md).
