import { defineSchema, type SchemaModel } from "@gleanql/core";

/** SchemaModel consumed by the analyzer/merger; mirrors support/schema.ts. */
export const mockSchema: SchemaModel = defineSchema({
  queryType: "Query",
  mutationType: "Mutation",
  subscriptionType: "Subscription",
  types: [
    {
      name: "Query",
      kind: "object",
      fields: {
        product: { name: "product", type: "Product", args: [{ name: "handle", type: "String!" }] },
        cart: { name: "cart", type: "Cart", args: [{ name: "id", type: "ID!" }] },
        collection: { name: "collection", type: "Collection", args: [{ name: "handle", type: "String!" }] },
        search: { name: "search", type: "SearchResultConnection", args: [{ name: "query", type: "String!" }] },
        // A top-level LIST root (`glean.products().map(...)`) — no object wrapper.
        products: { name: "products", type: "Product", list: true },
      },
    },
    {
      name: "Mutation",
      kind: "object",
      fields: {
        setProductTitle: {
          name: "setProductTitle",
          type: "Product",
          args: [
            { name: "id", type: "ID!" },
            { name: "title", type: "String!" },
          ],
        },
        // A scalar-returning mutation (exercises the leaf-root path).
        removeProduct: { name: "removeProduct", type: "ID", args: [{ name: "id", type: "ID!" }] },
      },
    },
    {
      name: "Subscription",
      kind: "object",
      fields: {
        productChanged: {
          name: "productChanged",
          type: "Product",
          args: [{ name: "handle", type: "String!" }],
        },
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
        url: { name: "url", type: "String", nonNull: true, args: [{ name: "transform", type: "ImageTransformInput" }] },
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
      fields: { nodes: { name: "nodes", type: "Product", list: true, nonNull: true } },
    },
    {
      name: "SearchResultConnection",
      kind: "object",
      fields: { nodes: { name: "nodes", type: "SearchResultItem", list: true, nonNull: true } },
    },
    { name: "SearchResultItem", kind: "union", possibleTypes: ["Product", "Collection"] },
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
    products: [Product!]
  }
  type Mutation {
    setProductTitle(id: ID!, title: String!): Product
    removeProduct(id: ID!): ID
  }
  type Subscription {
    productChanged(handle: String!): Product
  }
  input ImageTransformInput {
    maxWidth: Int
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
    url(transform: ImageTransformInput): String!
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
