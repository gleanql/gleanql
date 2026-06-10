import { defineSchema, type SchemaModel } from "@gleanql/core";

/** SchemaModel the compiler/runtime consume; mirrors graph/schema.ts. */
export const storefrontSchema: SchemaModel = defineSchema({
  queryType: "Query",
  types: [
    {
      name: "Query",
      kind: "object",
      fields: {
        product: { name: "product", type: "Product", args: [{ name: "handle", type: "String!" }] },
      },
    },
    {
      name: "Product",
      kind: "object",
      fields: {
        id: { name: "id", type: "ID", nonNull: true },
        handle: { name: "handle", type: "String", nonNull: true },
        title: { name: "title", type: "String", nonNull: true },
        descriptionHtml: { name: "descriptionHtml", type: "String", nonNull: true },
        featuredImage: { name: "featuredImage", type: "Image" },
        priceRange: { name: "priceRange", type: "ProductPriceRange", nonNull: true },
        views: { name: "views", type: "Int", nonNull: true },
      },
    },
    {
      name: "Image",
      kind: "object",
      fields: {
        url: { name: "url", type: "String", nonNull: true },
        altText: { name: "altText", type: "String" },
      },
    },
    {
      name: "ProductPriceRange",
      kind: "object",
      fields: { minVariantPrice: { name: "minVariantPrice", type: "MoneyV2", nonNull: true } },
    },
    {
      name: "MoneyV2",
      kind: "object",
      fields: {
        amount: { name: "amount", type: "String", nonNull: true },
        currencyCode: { name: "currencyCode", type: "String", nonNull: true },
      },
    },
    { name: "String", kind: "scalar" },
    { name: "ID", kind: "scalar" },
    { name: "Int", kind: "scalar" },
  ],
});
