import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyzeWithTs } from "../src/index.js";
import { mockSchema } from "./support/mock-schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const supportDir = path.join(here, "support");

/**
 * Variables-factory seam: a route param consumed by TWO different roots
 * (`glean.product({ handle: params.handle })` + `glean.collection({ handle:
 * params.handle })`). Both args are "simple" context paths named `handle`, so
 * the builder must dedupe them into ONE `$handle` — one variable definition on
 * the operation and one entry in the generated factory, not two.
 */
describe("variables factory: shared route param across roots", () => {
  const result = analyzeWithTs({
    fileName: path.join(here, "fixtures/35-shared-param/input.tsx"),
    supportDir,
    schema: mockSchema,
  });

  it("lifts the shared param to a single variable definition", () => {
    const op = result.operations[0]!;
    // Exactly one `$handle` definition in the operation header; both root
    // calls reference it. A duplicated def would be invalid GraphQL.
    expect(op.document.split("\n")[0]).toBe("query Route($handle: String!) {");
    expect(op.document.match(/\$handle: String!/g)).toHaveLength(1);
    expect(op.document.match(/handle: \$handle/g)).toHaveLength(2);
  });

  it("emits a single factory entry for the shared param", () => {
    const op = result.operations[0]!;
    expect(op.variablesFactory.exportName).toBe("getRouteVariables");
    expect(op.variablesFactory.source.trim()).toBe(
      `export function getRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}`,
    );
  });
});
