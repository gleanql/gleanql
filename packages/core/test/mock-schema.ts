import { defineSchema, type SchemaModel } from "../src/schema.js";

/**
 * Small mock schema mirroring the brief's PoC schema, expressed both as a
 * `SchemaModel` (what the compiler/merger consume) and as SDL (what graphql-js
 * uses in tests to validate that printed documents are real, valid GraphQL).
 */
export const mockSchema: SchemaModel = defineSchema({
  queryType: "Query",
  types: [
    {
      name: "Query",
      kind: "object",
      fields: {
        product: { name: "product", type: "Product", args: [{ name: "handle", type: "String!" }] },
        cart: { name: "cart", type: "Cart", args: [{ name: "id", type: "ID!" }] },
        collection: { name: "collection", type: "Collection", args: [{ name: "handle", type: "String!" }] },
        search: { name: "search", type: "SearchResultConnection", args: [{ name: "query", type: "String!" }] },
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
        availableForSale: { name: "availableForSale", type: "Boolean", nonNull: true },
        featuredImage: { name: "featuredImage", type: "Image" },
        priceRange: { name: "priceRange", type: "ProductPriceRange", nonNull: true },
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
      fields: {
        minVariantPrice: { name: "minVariantPrice", type: "MoneyV2", nonNull: true },
      },
    },
    {
      name: "MoneyV2",
      kind: "object",
      fields: {
        amount: { name: "amount", type: "String", nonNull: true },
        currencyCode: { name: "currencyCode", type: "String", nonNull: true },
      },
    },
    {
      name: "Cart",
      kind: "object",
      fields: {
        id: { name: "id", type: "ID", nonNull: true },
        totalQuantity: { name: "totalQuantity", type: "Int", nonNull: true },
      },
    },
    {
      name: "Collection",
      kind: "object",
      fields: {
        id: { name: "id", type: "ID", nonNull: true },
        title: { name: "title", type: "String", nonNull: true },
        image: { name: "image", type: "Image" },
        products: {
          name: "products",
          type: "ProductConnection",
          nonNull: true,
          args: [{ name: "first", type: "Int!" }],
        },
      },
    },
    {
      name: "ProductConnection",
      kind: "object",
      fields: {
        nodes: { name: "nodes", type: "Product", list: true, nonNull: true },
      },
    },
    {
      name: "SearchResultConnection",
      kind: "object",
      fields: {
        nodes: { name: "nodes", type: "SearchResultItem", list: true, nonNull: true },
      },
    },
    {
      name: "SearchResultItem",
      kind: "union",
      possibleTypes: ["Product", "Collection"],
    },
    { name: "String", kind: "scalar" },
    { name: "Boolean", kind: "scalar" },
    { name: "Int", kind: "scalar" },
    { name: "ID", kind: "scalar" },
  ],
});

export const mockSchemaSDL = /* GraphQL */ `
  type Query {
    product(handle: String!): Product
    cart(id: ID!): Cart
    collection(handle: String!): Collection
    search(query: String!): SearchResultConnection
  }
  type Product {
    id: ID!
    handle: String!
    title: String!
    descriptionHtml: String!
    availableForSale: Boolean!
    featuredImage: Image
    priceRange: ProductPriceRange!
  }
  type Image {
    url: String!
    altText: String
  }
  type ProductPriceRange {
    minVariantPrice: MoneyV2!
  }
  type MoneyV2 {
    amount: String!
    currencyCode: String!
  }
  type Cart {
    id: ID!
    totalQuantity: Int!
  }
  type Collection {
    id: ID!
    title: String!
    image: Image
    products(first: Int!): ProductConnection!
  }
  type ProductConnection {
    nodes: [Product!]!
  }
  type SearchResultConnection {
    nodes: [SearchResultItem!]!
  }
  union SearchResultItem = Product | Collection
`;
