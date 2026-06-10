import { describe, it, expect } from "vitest";
import { defineSchema, type OperationArtifact } from "@gleanql/core";
import { renderReadMask } from "../src/emit/readmask.js";
import { bindUseGleanComponent } from "../src/useglean-bind.js";

const schema = defineSchema({
  queryType: "Query",
  types: [
    { name: "ID", kind: "scalar" },
    { name: "String", kind: "scalar" },
    { name: "Query", kind: "object", fields: { product: { name: "product", type: "Product" } } },
    {
      name: "Product",
      kind: "object",
      fields: {
        id: { name: "id", type: "ID", nonNull: true },
        title: { name: "title", type: "String", nonNull: true },
        priceRange: { name: "priceRange", type: "ProductPriceRange", nonNull: true },
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
      fields: { amount: { name: "amount", type: "String", nonNull: true } },
    },
  ],
});

const op = (readMap: Record<string, string[]>): OperationArtifact =>
  ({ name: "Op", kind: "query", document: "", hash: "h", readMap }) as unknown as OperationArtifact;

describe("renderReadMask", () => {
  it("expands a deep read path into every hop pair + identity fields per type", () => {
    const mask = renderReadMask({ Op: op({ BuyBox: ["Product.priceRange.minVariantPrice.amount"] }) }, schema);
    expect(mask.BuyBox).toEqual(
      [
        "Product.__typename",
        "Product.id",
        "Product.priceRange",
        "ProductPriceRange.__typename",
        "ProductPriceRange.minVariantPrice",
        "MoneyV2.__typename",
        "MoneyV2.amount",
      ].sort(),
    );
  });

  it("merges a component's pairs across operations and stops at unresolvable hops", () => {
    const mask = renderReadMask(
      {
        A: op({ Card: ["Product.title"] }),
        B: op({ Card: ["Product.notInSchema.deeper"] }),
      },
      schema,
    );
    // The unresolvable segment itself is allowed (the compiler recorded the read);
    // nothing PAST it is guessed.
    expect(mask.Card).toContain("Product.title");
    expect(mask.Card).toContain("Product.notInSchema");
    expect(mask.Card!.some((p) => p.includes("deeper"))).toBe(false);
  });
});

describe("bindUseGleanComponent", () => {
  it("binds bare useGlean() to the enclosing component", () => {
    const out = bindUseGleanComponent(
      `import { useGlean } from "@gleanql/client/client";
export function BuyBox() {
  const g = useGlean();
  return null;
}`,
      "BuyBox.tsx",
    );
    expect(out).toContain('useGlean("BuyBox")');
  });

  it("leaves already-bound calls, other modules, and anonymous scopes alone", () => {
    expect(
      bindUseGleanComponent(
        `import { useGlean } from "@gleanql/client/client";
export function X() { return useGlean("Explicit"); }`,
        "x.tsx",
      ),
    ).toBeNull();
    expect(
      bindUseGleanComponent(`import { useGlean } from "other"; export function X() { return useGlean(); }`, "x.tsx"),
    ).toBeNull();
  });

  it("follows aliased imports", () => {
    const out = bindUseGleanComponent(
      `import { useGlean as useG } from "@gleanql/client/client";
const Row = () => { const g = useG(); return null; };`,
      "row.tsx",
    );
    expect(out).toContain('useG("Row")');
  });
});
