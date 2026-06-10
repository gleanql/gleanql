import { describe, it, expect } from "vitest";
import { buildSchema, introspectionFromSchema } from "graphql";
import { generateTypes, generateSchemaModel, generateGraph, type IntrospectionSchema } from "../src/index.js";

/**
 * Production schemas are not toy storefronts — GitHub's public schema is
 * ~1,600 types. This test runs the whole codegen path against a synthetic
 * schema of that scale and asserts it completes in sane time with sane
 * output. It exists to catch accidental O(n²) regressions in type/model
 * rendering before a real schema does.
 */

function syntheticSDL(typeCount: number, fieldsPerType: number): string {
  const parts: string[] = [];
  const query: string[] = [];
  for (let t = 0; t < typeCount; t++) {
    const fields: string[] = ["  id: ID!"];
    for (let f = 0; f < fieldsPerType; f++) {
      // A mix of scalars, references to other types, lists, and args.
      switch (f % 4) {
        case 0:
          fields.push(`  scalar${f}: String!`);
          break;
        case 1:
          fields.push(`  ref${f}: T${(t + f + 1) % typeCount}`);
          break;
        case 2:
          fields.push(`  list${f}: [T${(t + f * 7) % typeCount}!]`);
          break;
        default:
          fields.push(`  args${f}(first: Int, after: String): T${(t * 3 + f) % typeCount}`);
      }
    }
    parts.push(`type T${t} {\n${fields.join("\n")}\n}`);
    if (t % 50 === 0) query.push(`  root${t}(id: ID!): T${t}`);
  }
  return `type Query {\n${query.join("\n")}\n}\n\n${parts.join("\n\n")}`;
}

describe("codegen at production-schema scale", () => {
  // ~1,600 types × 13 fields ≈ GitHub's public schema in shape and size.
  const sdl = syntheticSDL(1600, 12);

  it("renders types + schema model + accessor for a 1,600-type schema in sane time", () => {
    const t0 = performance.now();
    const introspection = introspectionFromSchema(buildSchema(sdl)).__schema as unknown as IntrospectionSchema;
    const tIntrospect = performance.now();

    const types = generateTypes(introspection);
    const model = generateSchemaModel(introspection);
    const graph = generateGraph(introspection);
    const tDone = performance.now();

    // Output sanity: every type rendered, the model carries every field.
    expect((types.match(/export interface T\d+/g) ?? []).length).toBe(1600);
    expect(model).toContain('"T1599"');
    expect(graph).toContain("root1550");

    const codegenMs = tDone - tIntrospect;
    // Generous ceiling — this is a regression tripwire, not a benchmark.
    // (Measured ~1s on an M-series laptop; an O(n²) slip lands in minutes.)
    expect(codegenMs).toBeLessThan(30_000);
    console.log(
      `stress: introspection ${Math.round(tIntrospect - t0)}ms, ` +
        `codegen ${Math.round(codegenMs)}ms, ` +
        `types ${(types.length / 1024).toFixed(0)}kB, model ${(model.length / 1024).toFixed(0)}kB`,
    );
  });
});
