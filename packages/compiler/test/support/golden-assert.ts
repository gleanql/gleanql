import { expect } from "vitest";
import { buildSchema, parse, validate } from "graphql";
import type { AnalyzeResult } from "../../src/index.js";
import { readExpected } from "./golden-fixtures.js";
import { mockSchemaSDL } from "./mock-schema.js";

const gqlSchema = buildSchema(mockSchemaSDL);

/**
 * Assert an analysis result against whichever `expected.*` files the fixture has.
 * Engine-agnostic: both the `typescript` and tsgo golden suites call this, so a
 * split-file fixture is verified identically through either compiler backend.
 */
export function assertFixture(result: AnalyzeResult, dir: string): void {
  const expectedGraphql = readExpected(dir, "expected.graphql");
  if (expectedGraphql !== undefined) {
    const printed = result.operations.map((o) => o.document.trim()).join("\n\n");
    expect(printed.trim()).toBe(expectedGraphql.trim());
    for (const op of result.operations) {
      expect(validate(gqlSchema, parse(op.document)).map((e) => e.message)).toEqual([]);
    }
  }

  const expectedVars = readExpected(dir, "expected.variables.ts");
  if (expectedVars !== undefined) {
    expect((result.operations[0]?.variablesFactory.source ?? "").trim()).toBe(expectedVars.trim());
  }

  const expectedReadmap = readExpected(dir, "expected.readmap.json");
  if (expectedReadmap !== undefined) {
    expect(result.readMap).toEqual(JSON.parse(expectedReadmap));
  }

  const expectedDiagnostics = readExpected(dir, "expected.diagnostics.json");
  if (expectedDiagnostics !== undefined) {
    const actual = result.diagnostics.map((d) => ({ code: d.code, message: d.message }));
    expect(actual).toEqual(JSON.parse(expectedDiagnostics));
  }

  // Optional: assert the deferred/two-sweep flags on the first operation.
  const expectedMeta = readExpected(dir, "expected.meta.json");
  if (expectedMeta !== undefined) {
    const meta = JSON.parse(expectedMeta) as { deferred?: boolean; runtimeVars?: string[] };
    const op = result.operations[0];
    if (meta.deferred !== undefined) expect(op?.deferred ?? false).toBe(meta.deferred);
    if (meta.runtimeVars !== undefined) {
      expect([...(op?.runtimeVars ?? [])].sort()).toEqual([...meta.runtimeVars].sort());
    }
  }
}
