import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyzeWithTs } from "../src/index.js";
import { mockSchema } from "./support/mock-schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const supportDir = path.join(here, "support");

describe("analyzer smoke (acceptance criteria)", () => {
  const result = analyzeWithTs({
    fileName: path.join(here, "fixtures/acceptance/input.tsx"),
    supportDir,
    schema: mockSchema,
  });

  it("generates one operation", () => {
    expect(result.operations).toHaveLength(1);
  });

  it("matches the acceptance operation", () => {
    const op = result.operations[0]!;
    expect(op.document).toBe(`query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
    featuredImage {
      __typename
      url
    }
    priceRange {
      __typename
      minVariantPrice {
        __typename
        amount
        currencyCode
      }
    }
  }
}
`);
  });

  it("produces the read map", () => {
    expect(result.readMap).toEqual({
      ProductHero: ["Product.title", "Product.featuredImage.url"],
      BuyBox: [
        "Product.priceRange.minVariantPrice.amount",
        "Product.priceRange.minVariantPrice.currencyCode",
      ],
    });
  });

  it("produces the variables factory", () => {
    const op = result.operations[0]!;
    expect(op.variablesFactory.exportName).toBe("getProductRouteVariables");
    expect(op.variablesFactory.source.trim()).toBe(
      `export function getProductRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}`,
    );
  });
});
