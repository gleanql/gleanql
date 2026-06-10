import { describe, it, expect } from "vitest";
import { q } from "../src/builder.js";
import { mergeOperations } from "../src/merger.js";
import { printOperation } from "../src/printer.js";
import type { OperationIR } from "../src/ir.js";
import { mockSchema } from "./mock-schema.js";
import { validateDocument } from "./validate.js";

/**
 * Deliverable #7 from the brief: a tiny, manually-constructed ProductRoute
 * operation. Two component contributions (ProductHero, BuyBox) merge into one
 * operation at the Query root — exactly the shape the analyzer will produce.
 */

const heroContribution: OperationIR = q.operation({
  kind: "query",
  name: "ProductRoute",
  variables: { handle: "String!" },
  selection: q.select("Query", {
    product: q.field("product", {
      args: q.args({ handle: q.var("handle") }),
      selection: q.select("Product", {
        title: q.scalar("title"),
        featuredImage: q.field("featuredImage", {
          selection: q.select("Image", { url: q.scalar("url") }),
        }),
      }),
    }),
  }),
});

const buyBoxContribution: OperationIR = q.operation({
  kind: "query",
  name: "ProductRoute",
  variables: { handle: "String!" },
  selection: q.select("Query", {
    product: q.field("product", {
      args: q.args({ handle: q.var("handle") }),
      selection: q.select("Product", {
        priceRange: q.field("priceRange", {
          selection: q.select("ProductPriceRange", {
            minVariantPrice: q.field("minVariantPrice", {
              selection: q.select("MoneyV2", {
                amount: q.scalar("amount"),
                currencyCode: q.scalar("currencyCode"),
              }),
            }),
          }),
        }),
      }),
    }),
  }),
});

const EXPECTED = `query ProductRoute($handle: String!) {
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
`;

describe("manually-constructed ProductRoute operation", () => {
  const merged = mergeOperations("ProductRoute", [heroContribution, buyBoxContribution], mockSchema);
  const printed = printOperation(merged);

  it("merges two component contributions into one operation", () => {
    expect(printed).toBe(EXPECTED);
  });

  it("produces valid GraphQL", () => {
    expect(validateDocument(printed)).toEqual([]);
  });

  it("declares the handle variable exactly once", () => {
    expect(merged.variables).toEqual([{ name: "handle", type: "String!" }]);
  });
});
