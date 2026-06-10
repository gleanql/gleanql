import { describe, it, expect } from "vitest";
import { buildSchema, introspectionFromSchema } from "graphql";
import { defineSchema, type SchemaModel } from "@gleanql/core";
import {
  generateSchemaModel,
  generateTypes,
  generateGraph,
  generateSchemaPackage,
  type IntrospectionSchema,
} from "../src/index.js";

/** A storefront-shaped SDL exercising scalars, nullability, lists, args, unions, enums, inputs. */
const SDL = /* GraphQL */ `
  type Query {
    product(handle: String!): Product
    search(term: String!, first: Int): [SearchResultItem!]!
  }

  type Mutation {
    productUpdate(id: ID!, title: String!): ProductUpdatePayload!
  }

  type Product {
    id: ID!
    title: String!
    descriptionHtml: String
    featuredImage: Image
    images(first: Int!): [Image!]!
    priceRange: ProductPriceRange!
    status: ProductStatus!
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

  input ImageTransformInput {
    maxWidth: Int
    crop: Boolean
  }

  enum ProductStatus {
    ACTIVE
    DRAFT
  }

  type Collection {
    id: ID!
    title: String!
  }

  union SearchResultItem = Product | Collection

  type ProductUpdatePayload {
    product: Product
    userErrors: [UserError!]!
  }

  type UserError {
    field: [String!]
    message: String!
  }
`;

const introspection = introspectionFromSchema(buildSchema(SDL)).__schema as unknown as IntrospectionSchema;

/** Evaluate generated `schema-model.ts` source into a live SchemaModel. */
function evalSchemaModel(source: string): SchemaModel {
  const body = source
    .replace(/^import[^\n]*\n/m, "")
    .replace(/^export const schema: SchemaModel =/m, "const schema =");
  const make = new Function("defineSchema", `${body}\nreturn schema;`);
  return make(defineSchema) as SchemaModel;
}

describe("generateSchemaModel", () => {
  const model = evalSchemaModel(generateSchemaModel(introspection));

  it("captures root fields with their arguments", () => {
    const product = model.getRootField("product");
    expect(product).toMatchObject({ name: "product", type: "Product", args: [{ name: "handle", type: "String!" }] });
  });

  it("records identity, leaf-ness, lists, and callable fields", () => {
    expect(model.hasId("Product")).toBe(true);
    expect(model.hasId("MoneyV2")).toBe(false);
    expect(model.isLeaf("String")).toBe(true);
    expect(model.isLeaf("ProductStatus")).toBe(true); // enum is a leaf
    expect(model.getField("Product", "images")).toMatchObject({ type: "Image", list: true, nonNull: true });
    expect(model.getField("Image", "url")?.args).toEqual([{ name: "transform", type: "ImageTransformInput" }]);
  });

  it("models unions with their possible types", () => {
    expect(model.isUnionOrInterface("SearchResultItem")).toBe(true);
    expect([...model.possibleTypes("SearchResultItem")].sort()).toEqual(["Collection", "Product"]);
  });

  it("includes the mutation type", () => {
    expect(model.mutationType).toBe("Mutation");
    expect(model.getField("Mutation", "productUpdate")).toMatchObject({ type: "ProductUpdatePayload", nonNull: true });
  });
});

describe("generateTypes", () => {
  const types = generateTypes(introspection);

  it("brands object types with a literal __typename and renders nullability", () => {
    expect(types).toContain(`export interface Product {`);
    expect(types).toContain(`__typename: "Product";`);
    expect(types).toContain(`title: string;`); // String! -> non-null
    expect(types).toContain(`descriptionHtml: string | null;`); // String -> nullable
    expect(types).toContain(`featuredImage: Image | null;`);
  });

  it("renders lists with correct element nullability", () => {
    expect(types).toContain(`images(args: { first: number; }): Image[];`); // [Image!]!
    expect(types).toContain(`field: string[] | null;`); // [String!] on UserError
  });

  it("renders callable fields (field arguments) as methods", () => {
    expect(types).toContain(`url(args: { transform?: ImageTransformInput | null; }): string;`);
  });

  it("renders enums and unions", () => {
    expect(types).toContain(`export type ProductStatus = "ACTIVE" | "DRAFT";`);
    expect(types).toContain(`export type SearchResultItem = Product | Collection;`);
  });

  it("renders input objects with optional/required members", () => {
    expect(types).toContain(`export interface ImageTransformInput {`);
    expect(types).toContain(`maxWidth?: number | null;`);
  });

  it("respects custom scalar mappings", () => {
    const withCustom = generateTypes(introspection, { scalarTypes: { String: "MyString" } });
    expect(withCustom).toContain(`title: MyString;`);
  });
});

describe("generateGraph", () => {
  const graph = generateGraph(introspection);

  it("emits a typed accessor per root field plus components()", () => {
    expect(graph).toContain(`product(args: { handle: string; }): Product | null {`);
    expect(graph).toContain(`return undefined as unknown as Product | null;`);
    expect(graph).toContain(`search(args: { term: string; first?: number | null; }): SearchResultItem[] {`);
    expect(graph).toContain(`components<T extends Record<string, unknown>>(map: T): T {`);
  });

  it("imports the branded return types it references", () => {
    expect(graph).toMatch(/import type \{ [^}]*Product[^}]* \} from "\.\/schema\.js";/);
  });
});

describe("generateSchemaPackage", () => {
  it("returns all three sources together", () => {
    const pkg = generateSchemaPackage(introspection);
    expect(pkg.schemaModel).toContain("defineSchema");
    expect(pkg.types).toContain("export interface Product");
    expect(pkg.graph).toContain("export const glean");
  });
});
