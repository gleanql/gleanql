import { describe, it, expect } from "vitest";
import { defineSchema, type OperationArtifact } from "@gleanql/core";
import { renderOperationTypes } from "../src/emit/operation-types.js";
import { genClientDts } from "../src/emit/glue.js";

const schema = defineSchema({
  queryType: "Query",
  types: [
    { name: "ID", kind: "scalar" },
    { name: "String", kind: "scalar" },
    { name: "Int", kind: "scalar" },
    { name: "Query", kind: "object", fields: { product: { name: "product", type: "Product" } } },
    {
      name: "Product",
      kind: "object",
      fields: {
        id: { name: "id", type: "ID", nonNull: true },
        title: { name: "title", type: "String", nonNull: true },
        views: { name: "views", type: "Int", nonNull: true },
        tags: { name: "tags", type: "String", list: true },
      },
    },
  ],
});

const op = {
  name: "Report",
  kind: "query",
  document: "",
  hash: "h",
  variablesFactory: { exportName: "x", source: "" },
  readMap: {},
  variableDefs: [{ name: "handle", type: "String!" }, { name: "first", type: "Int" }],
  selection: {
    typeName: "Query",
    fields: [
      {
        name: "product",
        selection: {
          typeName: "Product",
          fields: [
            { name: "__typename" },
            { name: "id" },
            { name: "title", alias: "name" },
            { name: "views" },
            { name: "tags" },
          ],
        },
      },
    ],
  },
  stats: { fieldCount: 5, rootCount: 1, connectionCount: 0 },
} as unknown as OperationArtifact;

describe("renderOperationTypes", () => {
  const rendered = renderOperationTypes({ Report: op }, schema);

  it("types variables from the GraphQL defs (nullability + scalars)", () => {
    expect(rendered).toContain('readonly "Report":');
    expect(rendered).toContain("readonly handle: string; readonly first: number | null");
  });

  it("types data from the selection walked against the schema (alias, list, nullability)", () => {
    expect(rendered).toContain("readonly __typename: string;");
    expect(rendered).toContain("readonly id: string;");
    expect(rendered).toContain("readonly name: string;"); // alias wins as the key
    expect(rendered).toContain("readonly views: number;");
    expect(rendered).toContain("readonly tags: ReadonlyArray<string> | null;");
    expect(rendered).toContain("readonly product: {"); // nullable object field
    expect(rendered).toMatch(/readonly product: \{[\s\S]*?\} \| null;/);
  });

  it("flows into the glue dts as typed runOperation overloads + untyped fallback", () => {
    const dts = genClientDts(undefined, rendered);
    expect(dts).toContain("export interface GleanOperations {");
    expect(dts).toContain('runOperation<K extends keyof GleanOperations>(name: K, variables: GleanOperations[K]["variables"])');
    expect(dts).toContain("runOperation(name: string, variables?: Record<string, unknown>)");
  });

  it("omits the interface (fallback only) when no types are provided", () => {
    const dts = genClientDts();
    expect(dts).not.toContain("GleanOperations");
    expect(dts).toContain("export declare function runOperation(name: string");
  });
});
