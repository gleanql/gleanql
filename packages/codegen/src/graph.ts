import {
  isInternalType,
  namedTypeName,
  type IntrospectionField,
  type IntrospectionSchema,
  type IntrospectionTypeRef,
} from "./introspection.js";
import { DEFAULT_SCALAR_TYPES, indent, propKey, renderTs } from "./ts-render.js";

/**
 * Generate the `graph` accessor object: one method per Query root field plus the
 * `components(...)` registry helper. At build time the compiler reads these to
 * learn the root fields and their types; at runtime they are backed by the
 * runtime's bound graph (see `@gleanql/react`'s `bindGraph`). The generated bodies
 * are typed stubs — the real values are proxies.
 */

export interface GenerateGraphOptions {
  readonly scalarTypes?: Record<string, string>;
  /** Import path for the generated branded types. Default: `./schema.js`. */
  readonly schemaImportPath?: string;
}

export function generateGraph(schema: IntrospectionSchema, options: GenerateGraphOptions = {}): string {
  const scalars = { ...DEFAULT_SCALAR_TYPES, ...options.scalarTypes };
  const schemaImportPath = options.schemaImportPath ?? "./schema.js";

  const queryType = schema.types.find((t) => t.name === schema.queryType.name);
  const rootFields = queryType?.fields ?? [];

  // Which named types are emitted in schema.ts (so we can import them).
  const emitted = new Map<string, string>();
  for (const t of schema.types) {
    if (!isInternalType(t.name) && t.kind !== "SCALAR") emitted.set(t.name, t.kind);
  }

  const imports = new Set<string>();
  const collect = (ref: IntrospectionTypeRef): void => {
    const name = namedTypeName(ref);
    if (emitted.has(name)) imports.add(name);
  };
  for (const field of rootFields) {
    collect(field.type);
    for (const arg of field.args) collect(arg.type);
  }

  const lines: string[] = [];
  lines.push(`/** Generated from GraphQL introspection. Do not edit by hand. */`);
  if (imports.size > 0) {
    const names = [...imports].sort().join(", ");
    lines.push(`import type { ${names} } from ${JSON.stringify(schemaImportPath)};`);
    lines.push("");
  }
  lines.push(`export const glean = {`);
  for (const field of rootFields) {
    lines.push(indent(renderRoot(field, scalars), 2));
  }
  lines.push(`  components<T extends Record<string, unknown>>(map: T): T {`);
  lines.push(`    return map;`);
  lines.push(`  },`);
  lines.push(`};`);
  return lines.join("\n") + "\n";
}

function renderRoot(field: IntrospectionField, scalars: Record<string, string>): string {
  const ret = renderTs(field.type, scalars);
  // The args object is optional when every argument is — `glean.productsCount()`
  // should not demand an empty `{}`.
  const allOptional = field.args.every((a) => a.type.kind !== "NON_NULL");
  const params =
    field.args.length > 0
      ? `args${allOptional ? "?" : ""}: { ${field.args.map((a) => renderArg(a.name, a.type, scalars)).join(" ")} }`
      : "";
  return [
    `${propKey(field.name)}(${params}): ${ret} {`,
    `  return undefined as unknown as ${ret};`,
    `},`,
  ].join("\n");
}

function renderArg(name: string, type: IntrospectionTypeRef, scalars: Record<string, string>): string {
  const optional = type.kind !== "NON_NULL";
  return `${propKey(name)}${optional ? "?" : ""}: ${renderTs(type, scalars)};`;
}
