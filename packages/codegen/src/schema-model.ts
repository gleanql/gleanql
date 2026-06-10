import {
  isInternalType,
  isListType,
  isNonNull,
  namedTypeName,
  renderGraphQLType,
  type IntrospectionField,
  type IntrospectionSchema,
  type IntrospectionType,
} from "./introspection.js";
import { indent, propKey } from "./ts-render.js";

/**
 * Generate the `SchemaModel` source (`defineSchema({...})`) the compiler and
 * runtime consume. This is the machine-generated equivalent of the previously
 * hand-authored `schema-model.ts`.
 */

const KIND_MAP: Record<string, string> = {
  SCALAR: "scalar",
  OBJECT: "object",
  INTERFACE: "interface",
  UNION: "union",
  ENUM: "enum",
  INPUT_OBJECT: "input",
};

export interface GenerateSchemaModelOptions {
  /** Exported const name for the SchemaModel. Default: `schema`. */
  readonly exportName?: string;
}

export function generateSchemaModel(schema: IntrospectionSchema, options: GenerateSchemaModelOptions = {}): string {
  const exportName = options.exportName ?? "schema";
  const types = schema.types
    .filter((t) => !isInternalType(t.name))
    .map((t) => renderType(t))
    .filter((s): s is string => s !== undefined);

  const lines: string[] = [];
  lines.push(`import { defineSchema, type SchemaModel } from "@gleanql/core";`);
  lines.push("");
  lines.push(`/** Generated from GraphQL introspection. Do not edit by hand. */`);
  lines.push(`export const ${exportName}: SchemaModel = defineSchema({`);
  lines.push(`  queryType: ${JSON.stringify(schema.queryType.name)},`);
  if (schema.mutationType) lines.push(`  mutationType: ${JSON.stringify(schema.mutationType.name)},`);
  if (schema.subscriptionType) lines.push(`  subscriptionType: ${JSON.stringify(schema.subscriptionType.name)},`);
  lines.push(`  types: [`);
  for (const t of types) lines.push(indent(t, 4) + ",");
  lines.push(`  ],`);
  lines.push(`});`);
  return lines.join("\n") + "\n";
}

function renderType(type: IntrospectionType): string | undefined {
  const kind = KIND_MAP[type.kind];
  if (!kind) return undefined; // LIST/NON_NULL never appear at top level

  const parts: string[] = [`name: ${JSON.stringify(type.name)}`, `kind: ${JSON.stringify(kind)}`];

  if ((type.kind === "OBJECT" || type.kind === "INTERFACE") && type.fields) {
    const fields = type.fields.map((f) => `${propKey(f.name)}: ${renderField(f)}`);
    parts.push(`fields: { ${fields.join(", ")} }`);
  }
  if (type.kind === "UNION" && type.possibleTypes) {
    const names = type.possibleTypes.map((p) => JSON.stringify(namedTypeName(p)));
    parts.push(`possibleTypes: [${names.join(", ")}]`);
  }
  return `{ ${parts.join(", ")} }`;
}

function renderField(field: IntrospectionField): string {
  const parts: string[] = [`name: ${JSON.stringify(field.name)}`, `type: ${JSON.stringify(namedTypeName(field.type))}`];
  if (isListType(field.type)) parts.push(`list: true`);
  if (isNonNull(field.type)) parts.push(`nonNull: true`);
  if (field.args.length > 0) {
    const args = field.args.map((a) => `{ name: ${JSON.stringify(a.name)}, type: ${JSON.stringify(renderGraphQLType(a.type))} }`);
    parts.push(`args: [${args.join(", ")}]`);
  }
  return `{ ${parts.join(", ")} }`;
}
