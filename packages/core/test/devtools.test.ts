import { describe, it, expect } from "vitest";
import { renderReadMapTree, summarizeOperation } from "../src/devtools.js";

const readMap = {
  ProductHero: ["Product.title", "Product.featuredImage.url"],
  BuyBox: ["Product.priceRange.minVariantPrice.amount"],
};

describe("devtools", () => {
  it("renders the read map as a tree", () => {
    expect(renderReadMapTree("ProductRoute", readMap)).toBe(
      [
        "ProductRoute query",
        "  ProductHero",
        "    Product.title",
        "    Product.featuredImage.url",
        "  BuyBox",
        "    Product.priceRange.minVariantPrice.amount",
      ].join("\n"),
    );
  });

  it("does not warn for small operations", () => {
    const summary = summarizeOperation("ProductRoute", { fieldCount: 13, rootCount: 1, connectionCount: 0 }, readMap);
    expect(summary.warnings).toEqual([]);
    expect(summary.largestContributor).toEqual({ component: "ProductHero", reads: 2 });
  });

  it("warns for large operations with the largest contributor", () => {
    const big = { Recs: Array.from({ length: 50 }, (_, i) => `Product.f${i}`) };
    const summary = summarizeOperation("ProductRoute", { fieldCount: 184, rootCount: 6, connectionCount: 3 }, big, {
      fieldThreshold: 100,
    });
    expect(summary.warnings).toHaveLength(1);
    expect(summary.warnings[0]).toContain("184 fields across 6 roots");
    expect(summary.warnings[0]).toContain("Recs → 50 reads");
  });
});
