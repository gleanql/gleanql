import type { IntrospectionSchema } from "./introspection.js";
import { generateSchemaModel, type GenerateSchemaModelOptions } from "./schema-model.js";
import { generateTypes, type GenerateTypesOptions } from "./types.js";
import { generateGraph, type GenerateGraphOptions } from "./graph.js";

/**
 * `@gleanql/codegen` — generate a schema package from GraphQL introspection.
 *
 * The brief: "Generate a schema package from GraphQL introspection when the API
 * changes." This produces the three files the rest of the system consumes —
 * machine-generated equivalents of what was previously hand-authored:
 *
 *   schema-model.ts  the SchemaModel the compiler + runtime read
 *   schema.ts        branded TS types (so TypeScript catches API drift)
 *   graph.ts         the `graph.product(...)` accessors + `components(...)`
 *
 * Consume a real introspection result (`introspectionFromSchema(schema).__schema`
 * or the `data.__schema` from an introspection query).
 */
export * from "./introspection.js";
export * from "./schema-model.js";
export * from "./types.js";
export * from "./graph.js";

export interface GeneratedSchemaPackage {
  readonly schemaModel: string;
  readonly types: string;
  readonly graph: string;
}

export interface GenerateSchemaPackageOptions
  extends GenerateSchemaModelOptions,
    GenerateTypesOptions,
    GenerateGraphOptions {}

/** Generate all three source files from an introspection schema. */
export function generateSchemaPackage(
  schema: IntrospectionSchema,
  options: GenerateSchemaPackageOptions = {},
): GeneratedSchemaPackage {
  return {
    schemaModel: generateSchemaModel(schema, options),
    types: generateTypes(schema, options),
    graph: generateGraph(schema, options),
  };
}
