import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildSchema, introspectionFromSchema } from "graphql";
import { defineSchema, type SchemaModel } from "@gleanql/core";
import { generateSchemaModel, type IntrospectionSchema } from "@gleanql/codegen";
import { analyzeWithTs } from "@gleanql/compiler";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Closes the loop: a GraphQL schema (introspection) → generated SchemaModel →
 * drives the *real* compiler on ProductRoute.tsx → the same operation the
 * hand-authored schema produces. So codegen output is genuinely compiler-ready.
 */
const SDL = /* GraphQL */ `
  type Query { product(handle: String!): Product }
  type Product {
    id: ID!
    handle: String!
    title: String!
    descriptionHtml: String!
    featuredImage: Image
    priceRange: ProductPriceRange!
  }
  type Image { url: String!  altText: String }
  type ProductPriceRange { minVariantPrice: MoneyV2! }
  type MoneyV2 { amount: String!  currencyCode: String! }
`;

function generatedSchemaModel(): SchemaModel {
  const introspection = introspectionFromSchema(buildSchema(SDL)).__schema as unknown as IntrospectionSchema;
  const source = generateSchemaModel(introspection)
    .replace(/^import[^\n]*\n/m, "")
    .replace(/^export const schema: SchemaModel =/m, "const schema =");
  return new Function("defineSchema", `${source}\nreturn schema;`)(defineSchema) as SchemaModel;
}

describe("codegen → compiler (loop closure)", () => {
  it("compiles ProductRoute against the generated schema to the acceptance operation", () => {
    const result = analyzeWithTs({
      fileName: path.join(here, "routes/ProductRoute.tsx"),
      supportDir: path.join(here, "graph"),
      schema: generatedSchemaModel(),
    });
    const op = result.operations[0]!;

    expect(op.document.trim()).toBe(
      [
        "query ProductRoute($handle: String!) {",
        "  product(handle: $handle) {",
        "    __typename",
        "    id",
        "    title",
        "    featuredImage {",
        "      __typename",
        "      url",
        "    }",
        "    priceRange {",
        "      __typename",
        "      minVariantPrice {",
        "        __typename",
        "        amount",
        "        currencyCode",
        "      }",
        "    }",
        "  }",
        "}",
      ].join("\n"),
    );
    expect(result.readMap).toEqual({
      ProductHero: ["Product.title", "Product.featuredImage.url"],
      BuyBox: [
        "Product.priceRange.minVariantPrice.amount",
        "Product.priceRange.minVariantPrice.currencyCode",
      ],
    });
  });
});
