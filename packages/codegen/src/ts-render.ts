import type { IntrospectionTypeRef } from "./introspection.js";

/** Shared TypeScript-type rendering for branded types and the graph accessors. */

export const DEFAULT_SCALAR_TYPES: Record<string, string> = {
  String: "string",
  ID: "string",
  Int: "number",
  Float: "number",
  Boolean: "boolean",
};

/** Render a TS type from a GraphQL type ref, honoring list + nullability nesting. */
export function renderTs(ref: IntrospectionTypeRef, scalars: Record<string, string>): string {
  if (ref.kind === "NON_NULL") return renderTsInner(ref.ofType, scalars);
  return `${renderTsInner(ref, scalars)} | null`;
}

function renderTsInner(ref: IntrospectionTypeRef, scalars: Record<string, string>): string {
  if (ref.kind === "NON_NULL") return renderTsInner(ref.ofType, scalars);
  if (ref.kind === "LIST") {
    const el = renderTs(ref.ofType, scalars);
    return `${el.includes(" ") ? `(${el})` : el}[]`;
  }
  if (ref.kind === "SCALAR") return scalars[ref.name] ?? "string";
  return ref.name; // OBJECT / INTERFACE / UNION / ENUM / INPUT_OBJECT
}

/** A bare property key when safe, else a quoted key. */
export function propKey(name: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

/** Indent every non-empty line of `text` by `spaces` columns. */
export function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line) => (line ? pad + line : line))
    .join("\n");
}
