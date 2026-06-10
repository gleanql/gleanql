---
title: @gleanql/core
group: Internals
order: 6
---

# `@gleanql/core`

The framework-agnostic foundation: the query IR, the `q.*` builder, the selection merger, the GraphQL printer, the schema model, the operation artifact, and devtools.

## Query IR

The compiler never emits GraphQL strings directly. It produces this IR, which is merged and then printed. Keeping an IR between extraction and printing is what enables dedupe-by-canonical-path, identity injection, and directives without string surgery.

```tsx
interface OperationIR {
  kind: "query" | "mutation" | "subscription";
  name: string;
  variables: readonly { name: string; type: string }[];
  selection: SelectionSet;
}

interface SelectionSet {
  typeName: string;                       // GraphQL type this set is on
  fields: readonly FieldSelection[];
  inlineFragments?: readonly InlineFragment[]; // ... on T { … }
}

interface FieldSelection {
  name: string;
  alias?: string;                         // emitted only when present
  args?: ArgMap;
  directives?: readonly Directive[];
  selection?: SelectionSet;            // object fields only
}

type ArgValue =
  | { kind: "var"; name: string }       // $handle
  | { kind: "literal"; value: … }
  | { kind: "enum"; value: string }
  | { kind: "list"; items: ArgValue[] }
  | { kind: "object"; fields: [string, ArgValue][] };
```

Variable references (`q.var`) are how arbitrary argument expressions get lifted into the generated variables factory; literals are what allow argument-level dedupe.

## The `q.*` builder

The compiler emits calls to these helpers (and there's a human-authored escape hatch using the same surface). `q.select` takes a record keyed by *response key* (the alias if aliased, else the field name); each value carries the real field name.

```tsx
q.operation({ kind, name, variables, selection })
q.select(typeName, { responseKey: fieldSelection, … }, inlineFragments?)
q.field(name, { args?, directives?, selection?, alias? })
q.scalar(name, { args?, directives?, alias? })
q.inlineFragment(onType, selection)
q.var(name) · q.literal(v) · q.enumValue(v) · q.list([…]) · q.object(argMap) · q.args({…})
```

## The selection merger

Given any number of selection-set contributions over the same type (one per component read, or per dynamic-component candidate), `mergeSelectionSets` produces one canonical set.

### 1 · Dedupe identity

Two fields are "the same" — and merge their sub-selections — only when these are all equal:

| Component | Notes |
| --- | --- |
| parent path | position in the tree |
| field name | |
| canonical arguments | order-independent; `{a:1,b:2}` ≡ `{b:2,a:1}` |
| directives | canonicalized too |
| result type | implied by parent type + name |

```tsx
// these dedupe → one `title`
product.title; product.title;

// these merge → featuredImage { url altText }
product.featuredImage?.url; product.featuredImage?.altText;
```

### 2 · Argument conflicts → aliases

Same field name, different args, both present ⇒ both get a generated alias `${name}_${suffix}` where the suffix is derived deterministically from the arguments.

```tsx
collection.products({ first: 12 })   // products_first12: products(first: 12)
collection.products({ first: 24 })   // products_first24: products(first: 24)
```

A field that appears only once keeps its bare name, even with arguments.

### 3 · Identity injection

Every *non-root* object selection gets `__typename`; types that expose an `id` field also get `id` — even if no component read them.

> [!WARNING]
> **Consistent rule.** `__typename` is always injected for object selections — including pure-scalar leaf objects like `MoneyV2`. One uniform rule keeps generated documents predictable; see [Design decisions](decisions.md).

### 4 · Deterministic order

Output order within a selection is: `__typename`, then `id`, then user fields in first-seen order. This is what makes golden output stable.

```tsx
mergeSelectionSets(sets, schema, { isRoot? })  // merge contributions on one type
mergeOperations(name, ops, schema)             // merge whole operations (root not given identity)
```

> [!NOTE]
> **Operation-level vs cache-level dedupe are separate.** The merger does *operation-level* dedupe (merge identical query paths into one document). *Cache-level* dedupe (normalize entities by `__typename + id`) happens in the runtime.

## GraphQL printer

The only place IR becomes a string. Deterministic two-space indentation; fields print in IR order (already canonicalized by the merger). `printOperation(op)`, plus `printArgs` / `printArgValue`.

## Schema model

Just enough schema knowledge to resolve a field's type, know identity, distinguish leaf/object/union/list, and validate roots. Hand-authorable via `defineSchema(...)`; an introspection-driven generator can produce the same shape.

```tsx
schema.getField(typeName, fieldName)   // → { type, list?, nonNull?, args? }
schema.hasId(typeName)                 // has a scalar `id`?
schema.isLeaf(typeName)                // scalar/enum
schema.isObjectLike(typeName)          // object/interface/union
schema.isUnionOrInterface(typeName)
schema.possibleTypes(typeName)         // union members
schema.getRootField(name)
```

## Operation artifact

A compiled operation bundles more than the document — this is what a framework adapter loads to drive a route.

```tsx
interface OperationArtifact {
  name: string;
  kind: "query" | "mutation" | "subscription";
  document: string;                              // printed GraphQL
  hash: string;                                  // FNV-1a, for persisted queries / devtools
  variablesFactory: { exportName: string; source: string };
  readMap: Record<string, readonly string[]>;    // component → ["Type.path", …]
  source?: string;                               // originating module
  stats: { fieldCount; rootCount; connectionCount };
}
```

## Devtools

`renderReadMapTree(name, readMap)` prints the per-component read tree; `summarizeOperation(...)` flags large/expensive operations (field/root/connection counts + the largest contributing component).

```tsx
ProductRoute query
  ProductHero
    Product.title
    Product.featuredImage.url
  BuyBox
    Product.priceRange.minVariantPrice.amount
    Product.priceRange.minVariantPrice.currencyCode
```

## Human-authored escape hatch

Normal app code relies on compiler extraction. For the rare hand-written operation, `buildQuery` offers a fluent, schema-free builder: scalar fields are read as properties, object fields are called with a selection callback, and the variables proxy yields `$var` references. Output is printed verbatim (no identity injection — the author controls the exact selection).

```tsx
buildQuery("ProductQuery", { handle: "String!" }, (root, $) => ({
  product: root.product({ handle: $.handle }, (p) => ({
    title: p.title,
    featuredImage: p.featuredImage((image) => ({ url: image.url })),
  })),
}));
```

## Directives

The IR can express directives (`@include`/`@skip` and contextual ones) even though v1 exposes no public directive API. They survive merging and printing:

```tsx
descriptionHtml @include(if: $expanded)
```

---

Next: [@gleanql/compiler](compiler.md) — how reads & prop flow are extracted from source.
