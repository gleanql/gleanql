import { buildSchema, parse, validate, type GraphQLSchema } from "graphql";
import { mockSchemaSDL } from "./mock-schema.js";

let cached: GraphQLSchema | undefined;

function schema(): GraphQLSchema {
  cached ??= buildSchema(mockSchemaSDL);
  return cached;
}

/**
 * Assert that a printed document is real, valid GraphQL against the mock
 * schema. Returns formatted error messages (empty array = valid).
 */
export function validateDocument(document: string): string[] {
  const errors = validate(schema(), parse(document));
  return errors.map((e) => e.message);
}
