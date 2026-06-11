import { describe, it, expect } from "vitest";
import { defineSchema } from "@gleanql/core";
import type { OperationArtifact } from "@gleanql/core";
import { renderSlimSchemaModelJs, slimRuntimeSchema } from "../src/slim-schema.js";

const schema = defineSchema({
  queryType: "Query",
  mutationType: "Mutation",
  types: [
    { name: "ID", kind: "scalar" },
    { name: "String", kind: "scalar" },
    { name: "Int", kind: "scalar" },
    { name: "ProductStatus", kind: "enum" },
    {
      name: "Query",
      kind: "object",
      fields: {
        product: { name: "product", type: "Product", args: [{ name: "handle", type: "String!" }] },
        orders: { name: "orders", type: "OrderConnection" },
      },
    },
    {
      name: "Mutation",
      kind: "object",
      fields: { productUpdate: { name: "productUpdate", type: "Product" } },
    },
    {
      name: "Product",
      kind: "object",
      fields: {
        id: { name: "id", type: "ID", nonNull: true },
        title: { name: "title", type: "String", nonNull: true },
        vendor: { name: "vendor", type: "String", nonNull: true },
        status: { name: "status", type: "ProductStatus", nonNull: true },
        variants: {
          name: "variants",
          type: "VariantConnection",
          args: [{ name: "first", type: "Int" }],
        },
      },
    },
    // Identified by a non-`id` key: the slim model must keep the key field
    // even though no selection reads it.
    {
      name: "Sku",
      kind: "object",
      keys: ["code"],
      fields: {
        code: { name: "code", type: "String", nonNull: true },
        label: { name: "label", type: "String" },
      },
    },
    {
      name: "VariantConnection",
      kind: "object",
      fields: { nodes: { name: "nodes", type: "Sku", list: true, nonNull: true } },
    },
    // Never reached by any selection — must NOT survive slimming.
    {
      name: "Order",
      kind: "object",
      fields: { id: { name: "id", type: "ID", nonNull: true } },
    },
    {
      name: "OrderConnection",
      kind: "object",
      fields: { nodes: { name: "nodes", type: "Order", list: true, nonNull: true } },
    },
  ],
});

function artifact(selection: OperationArtifact["selection"]): OperationArtifact {
  return {
    name: "Test",
    kind: "query",
    document: "query Test { __typename }",
    hash: "0".repeat(64),
    variablesFactory: { exportName: "getTestVariables", source: "" },
    readMap: {},
    selection,
    variables: [],
  } as unknown as OperationArtifact;
}

const productSelection = {
  typeName: "Query",
  fields: [
    {
      name: "product",
      selection: {
        typeName: "Product",
        fields: [
          { name: "title" },
          {
            name: "variants",
            selection: {
              typeName: "VariantConnection",
              fields: [
                { name: "nodes", selection: { typeName: "Sku", fields: [{ name: "label" }] } },
              ],
            },
          },
        ],
      },
    },
  ],
};

describe("slimRuntimeSchema", () => {
  const init = slimRuntimeSchema(schema, { Test: artifact(productSelection) });
  const byName = new Map(init.types.map((t) => [t.name, t]));

  it("keeps only selection-reachable types (plus stubs), drops the rest", () => {
    expect(byName.has("Order")).toBe(false);
    expect(byName.has("OrderConnection")).toBe(false);
    expect(byName.has("Mutation")).toBe(false);
    expect(byName.has("Query")).toBe(true);
    expect(byName.has("Product")).toBe(true);
  });

  it("keeps selected fields with their args, drops unselected ones", () => {
    const product = byName.get("Product")!;
    expect(Object.keys(product.fields!).sort()).toEqual(["id", "title", "variants"]);
    expect(product.fields!.variants?.args).toEqual([{ name: "first", type: "Int" }]);
    expect(product.fields!.vendor).toBeUndefined();
  });

  it("keeps identity fields even when unread", () => {
    // `id` on Product (default identity), `code` on Sku (explicit keys).
    expect(byName.get("Product")!.fields!.id).toBeDefined();
    const sku = byName.get("Sku")!;
    expect(sku.keys).toEqual(["code"]);
    expect(sku.fields!.code).toBeDefined();
  });

  it("stubs leaf types of kept fields so isLeaf classification holds", () => {
    expect(byName.get("String")).toMatchObject({ kind: "scalar" });
    expect(byName.get("ID")).toMatchObject({ kind: "scalar" });
  });

  it("round-trips through defineSchema with identical runtime answers", () => {
    const slim = defineSchema(init);
    expect(slim.identityOf("Product", { id: "1" })).toBe(schema.identityOf("Product", { id: "1" }));
    expect(slim.identityOf("Sku", { code: "x" })).toBe(schema.identityOf("Sku", { code: "x" }));
    expect(slim.keyFields("Sku")).toEqual(schema.keyFields("Sku"));
    expect(slim.isLeaf("String")).toBe(true);
    expect(slim.getField("Product", "variants")?.args).toEqual(
      schema.getField("Product", "variants")?.args,
    );
  });
});

describe("renderSlimSchemaModelJs", () => {
  it("emits a module exporting `schema` (the shape operations.js re-exports)", () => {
    const src = renderSlimSchemaModelJs(slimRuntimeSchema(schema, { Test: artifact(productSelection) }));
    expect(src).toContain('import { defineSchema } from "@gleanql/core"');
    expect(src).toContain("export const schema = defineSchema(");
    expect(src).not.toContain("Order");
  });
});
