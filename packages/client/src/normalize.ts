import type { GraphCache, GraphRef, FieldValue } from "./cache.js";

/**
 * Normalize a GraphQL JSON result into the cache.
 *
 * Every object selection includes `__typename` (and `id` when the type has one),
 * so the result alone carries enough to choose an identity:
 *  - `__typename + id` -> normalized entity record, deduped across queries.
 *  - id-less object     -> embedded under its *owning entity* at the field path
 *    since that entity (`Product:123.priceRange`), NOT the query path. So the same
 *    nested object reached through two different queries resolves to one record —
 *    update it once and every reader sees it, and a second query needn't refetch.
 *  - id-less with no entity ancestor (root objects) -> anchored at the operation
 *    path (`Query.search(q)`), which is the only correct identity for them.
 * Scalars store inline; object fields store a `GraphRef`; lists store an array.
 *
 * `anchor` is the nearest owning entity's record key (or the root path); `field`
 * is the path from that anchor.
 */
/**
 * Resolve an object's identity value from its `__typename`, or undefined when
 * the object is id-less (and must be embedded). Defaults to the `id` field;
 * supply a schema-derived resolver to key types by another field (`sku`, `slug`)
 * or a composite.
 */
export type KeyOf = (typename: string, obj: Record<string, unknown>) => string | undefined;

const defaultKeyOf: KeyOf = (_t, obj) => (obj.id != null ? String(obj.id) : undefined);

export function normalizeValue(
  cache: GraphCache,
  value: unknown,
  anchor: string,
  field: string,
  keyOf: KeyOf = defaultKeyOf,
  seen: WeakSet<object> = new WeakSet(),
): FieldValue {
  if (value === null || typeof value !== "object") return value as FieldValue;
  // GraphQL JSON can't be cyclic, but optimistic/user-built objects can — fail
  // with a clear message instead of blowing the stack. `seen` tracks the CURRENT
  // DESCENT PATH (entries are removed on the way back up), so a DAG — the same
  // object referenced from two siblings — still normalizes fine.
  if (seen.has(value)) {
    throw new Error(`normalizeValue: circular reference at ${anchor}.${field} — cannot normalize cyclic data`);
  }
  seen.add(value);
  try {
    return normalizeNonCyclic(cache, value, anchor, field, keyOf, seen);
  } finally {
    seen.delete(value);
  }
}

function normalizeNonCyclic(
  cache: GraphCache,
  value: object,
  anchor: string,
  field: string,
  keyOf: KeyOf,
  seen: WeakSet<object>,
): FieldValue {
  if (Array.isArray(value)) {
    return value.map((item, i) => normalizeValue(cache, item, anchor, `${field}.${i}`, keyOf, seen));
  }

  const obj = value as Record<string, unknown>;
  const typename = typeof obj.__typename === "string" ? obj.__typename : undefined;
  const identity = typename != null ? keyOf(typename, obj) : undefined;

  if (typename != null && identity != null) {
    // Identified entity: a new normalization anchor; child paths reset under it.
    const ref: GraphRef = { __typename: typename, id: identity };
    const entityAnchor = cache.recordKey(ref);
    for (const [key, v] of Object.entries(obj)) {
      cache.setField(ref, key, normalizeValue(cache, v, entityAnchor, key, keyOf, seen));
    }
    return ref;
  }

  // Id-less: embed under the owning entity at `anchor.field` (stays anchored to
  // the same entity as we descend, so it dedupes across queries).
  const ref: GraphRef = { path: `${anchor}.${field}` };
  for (const [key, v] of Object.entries(obj)) {
    cache.setField(ref, key, normalizeValue(cache, v, anchor, `${field}.${key}`, keyOf, seen));
  }
  return ref;
}

/** Seed an operation result; returns each root field's ref for reading. */
export function seedResult(
  cache: GraphCache,
  data: Readonly<Record<string, unknown>>,
  options: { rootPath?: string; keyOf?: KeyOf } = {},
): Record<string, FieldValue> {
  const rootPath = options.rootPath ?? "Query";
  const roots: Record<string, FieldValue> = {};
  for (const [field, value] of Object.entries(data)) {
    roots[field] = normalizeValue(cache, value, rootPath, field, options.keyOf);
  }
  return roots;
}
