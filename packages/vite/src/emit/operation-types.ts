import type { OperationArtifact, SchemaModel, SelectionSet } from "@gleanql/core";

/**
 * Generated result/variable types for every operation, rendered into the glue
 * `.d.ts` as a `GleanOperations` interface — `runOperation("Report", vars)`
 * types its `variables` AND its `data` by name, with an untyped fallback for
 * dynamic names. Types are derived from the compiled selection walked against
 * the schema model, so they match exactly what the operation can return.
 */

const SCALARS: Record<string, string> = {
  ID: "string",
  String: "string",
  Int: "number",
  Float: "number",
  Boolean: "boolean",
};

/** GraphQL type ref → TS, e.g. `String!` → string, `[Int!]` → ReadonlyArray<number> | null. */
function tsOfTypeRef(ref: string, schema: SchemaModel): string {
  const nonNull = ref.endsWith("!");
  const inner = nonNull ? ref.slice(0, -1) : ref;
  let ts: string;
  if (inner.startsWith("[") && inner.endsWith("]")) {
    ts = `ReadonlyArray<${tsOfTypeRef(inner.slice(1, -1), schema)}>`;
  } else {
    ts = SCALARS[inner] ?? (schema.getType(inner)?.kind === "enum" ? "string" : "unknown");
  }
  return nonNull ? ts : `${ts} | null`;
}

/** A selection set's result shape. Unknown fields (custom resolvers) fall back to unknown. */
function tsOfSelection(set: SelectionSet, schema: SchemaModel, indent: string): string {
  const pad = indent + "  ";
  const lines: string[] = [];
  for (const field of set.fields) {
    const key = field.alias ?? field.name;
    if (field.name === "__typename") {
      lines.push(`${pad}readonly __typename: string;`);
      continue;
    }
    const def = schema.getField(set.typeName, field.name);
    if (!def) {
      lines.push(`${pad}readonly ${key}: unknown;`);
      continue;
    }
    let ts: string;
    if (field.selection) {
      ts = tsOfSelection(field.selection, schema, pad);
    } else {
      ts = SCALARS[def.type] ?? (schema.getType(def.type)?.kind === "enum" ? "string" : "unknown");
    }
    // FieldDef models outer nullability only; list elements render non-null.
    if (def.list) ts = `ReadonlyArray<${ts}>`;
    if (!def.nonNull) ts = `${ts} | null`;
    lines.push(`${pad}readonly ${key}: ${ts};`);
  }
  // Union/interface narrowing contributes optionally — a result row is one member.
  for (const frag of set.inlineFragments ?? []) {
    lines.push(`${pad}// ... on ${frag.onType} (narrowed fields are optional on the union)`);
    const inner = tsOfSelection(frag.selection, schema, pad);
    lines.push(`${pad}readonly __on${frag.onType}?: ${inner};`);
  }
  return `{\n${lines.join("\n")}\n${indent}}`;
}

/** The `GleanOperations` interface body for every compiled + registered operation. */
export function renderOperationTypes(operations: Record<string, OperationArtifact>, schema: SchemaModel): string {
  const entries = Object.values(operations).map((op) => {
    const vars =
      op.variableDefs && op.variableDefs.length > 0
        ? `{ ${op.variableDefs.map((v) => `readonly ${v.name}: ${tsOfTypeRef(v.type, schema)}`).join("; ")} }`
        : "Record<string, never>";
    const data = tsOfSelection(op.selection, schema, "    ");
    return `  readonly ${JSON.stringify(op.name)}: {\n    readonly variables: ${vars};\n    readonly data: ${data};\n  };`;
  });
  return `export interface GleanOperations {\n${entries.join("\n")}\n}`;
}
