import { canonicalArgs, responseKey, type ArgMap, type ArgValue, type SelectionSet, type FieldSelection } from "@gleanql/core";
import type { GraphCache, GraphRef, FieldValue } from "./cache.js";
import { isGraphRef } from "./proxy.js";

/**
 * Cache-first resolution.
 *
 * Before executing an operation over the network, check whether the normalized
 * cache already satisfies its entire selection. The link from a root call to its
 * entity (`product(handle:"x") -> Product:123`) is persisted under the root
 * record, so a re-run, a back-navigation, or data another writer already filled
 * (mutation, subscription, sibling query) resolves with zero requests. Coverage
 * is all-or-nothing here; partial gaps fall back to a full fetch (a future
 * `node(id:)` patch could fetch only the missing fields).
 */
const ROOT = "Query";

function resolveArg(v: ArgValue, vars: Record<string, unknown>): ArgValue {
  // Substitute the operation variable; canonicalArgValue JSON-stringifies the value.
  if (v.kind === "var") return { kind: "literal", value: (vars[v.name] ?? null) as string | number | boolean | null };
  if (v.kind === "list") return { kind: "list", items: v.items.map((i) => resolveArg(i, vars)) };
  if (v.kind === "object") return { kind: "object", fields: v.fields.map(([k, fv]) => [k, resolveArg(fv, vars)] as const) };
  return v;
}

/** Stable per-root-call key (`product(handle:"x")`), with operation variables substituted. */
function rootLinkKey(field: FieldSelection, vars: Record<string, unknown>): string {
  const resolved: ArgMap = (field.args ?? []).map(([k, v]) => [k, resolveArg(v, vars)] as const);
  return `${field.name}(${canonicalArgs(resolved)})`;
}

/** Record each root field's resolved ref so a later run finds the entity without a fetch. */
export function persistRootLinks(
  cache: GraphCache,
  selection: SelectionSet,
  vars: Record<string, unknown>,
  roots: Record<string, FieldValue>,
  rootPath: string = ROOT,
): void {
  const rec: GraphRef = { path: rootPath };
  for (const field of selection.fields) {
    const key = responseKey(field);
    if (key in roots) cache.setField(rec, rootLinkKey(field, vars), roots[key] as FieldValue);
  }
}

/** Does `ref`'s record cover every field in `selection` (recursively)? */
function covers(cache: GraphCache, ref: GraphRef, selection: SelectionSet): boolean {
  for (const field of selection.fields) {
    const got = cache.getField(ref, responseKey(field));
    if (got.status !== "ready") return false;
    if (field.selection && !coversValue(cache, got.value, field.selection)) return false;
  }
  for (const frag of selection.inlineFragments ?? []) {
    if (ref.__typename === frag.onType && !covers(cache, ref, frag.selection)) return false;
  }
  return true;
}

function coversValue(cache: GraphCache, value: FieldValue, selection: SelectionSet): boolean {
  if (value == null) return true; // nullable object — nothing deeper to require
  if (Array.isArray(value)) return value.every((v) => coversValue(cache, v, selection));
  if (isGraphRef(value)) return covers(cache, value, selection);
  return true; // scalar where an object was expected — tolerate, don't block
}

export interface CacheResolution {
  readonly covered: boolean;
  readonly roots: Record<string, FieldValue>;
}

/**
 * Try to satisfy an operation entirely from cache. `covered` is true only when
 * every root link exists and every selected field beneath it is present.
 */
export function resolveFromCache(
  cache: GraphCache,
  selection: SelectionSet,
  vars: Record<string, unknown>,
  rootPath: string = ROOT,
): CacheResolution {
  const rec: GraphRef = { path: rootPath };
  const roots: Record<string, FieldValue> = {};
  for (const field of selection.fields) {
    const link = cache.getField(rec, rootLinkKey(field, vars));
    if (link.status !== "ready") return { covered: false, roots: {} };
    const ref = link.value;
    if (ref == null) {
      roots[responseKey(field)] = null;
      continue;
    }
    if (field.selection && (!isGraphRef(ref) || !covers(cache, ref, field.selection))) {
      return { covered: false, roots: {} };
    }
    roots[responseKey(field)] = ref;
  }
  return { covered: true, roots };
}
