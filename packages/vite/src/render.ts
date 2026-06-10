import type { IntrospectionTypeRef } from "@gleanql/codegen";

/** GraphQL scalar → TypeScript type. Unlisted custom scalars default to `string`. */
export const SCALARS: Record<string, string> = {
  String: "string",
  ID: "string",
  Int: "number",
  Float: "number",
  Boolean: "boolean",
};

/** The named type at the bottom of a (possibly list/non-null) type ref. */
export function namedTypeName(ref: IntrospectionTypeRef): string {
  let cur: IntrospectionTypeRef = ref;
  while (cur.kind === "LIST" || cur.kind === "NON_NULL") cur = cur.ofType;
  return cur.name;
}

export function collectNamed(ref: IntrospectionTypeRef, set: Set<string>): void {
  set.add(namedTypeName(ref));
}

/** Render a TS type from a GraphQL type ref (nullable form: `T | null`). */
export function renderTs(ref: IntrospectionTypeRef): string {
  if (ref.kind === "NON_NULL") return renderTsInner(ref.ofType);
  return `${renderTsInner(ref)} | null`;
}

/** Render the non-null form (used for root accessor returns, which are non-null in app code). */
export function renderTsInner(ref: IntrospectionTypeRef): string {
  if (ref.kind === "NON_NULL") return renderTsInner(ref.ofType);
  if (ref.kind === "LIST") {
    const el = renderTs(ref.ofType);
    return `${el.includes(" ") ? `(${el})` : el}[]`;
  }
  if (ref.kind === "SCALAR") return SCALARS[ref.name] ?? "string";
  return ref.name;
}
