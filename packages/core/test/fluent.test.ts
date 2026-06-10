import { describe, it, expect } from "vitest";
import { buildQuery } from "../src/fluent.js";
import { printOperation } from "../src/printer.js";
import { validateDocument } from "./validate.js";

describe("fluent escape hatch (q.query)", () => {
  const op = buildQuery("ProductQuery", { handle: "String!" }, (root, $) => ({
    product: root.product({ handle: $.handle }, (p: any) => ({
      title: p.title,
      featuredImage: p.featuredImage((image: any) => ({ url: image.url })),
    })),
  }));
  const printed = printOperation(op);

  it("builds the authored operation verbatim (no identity injection)", () => {
    expect(printed).toBe(`query ProductQuery($handle: String!) {
  product(handle: $handle) {
    title
    featuredImage {
      url
    }
  }
}
`);
  });

  it("produces valid GraphQL", () => {
    expect(validateDocument(printed)).toEqual([]);
  });

  it("supports aliases for differing response keys", () => {
    const aliased = buildQuery("Q", { h: "String!" }, (root, $) => ({
      item: root.product({ handle: $.h }, (p: any) => ({ name: p.title })),
    }));
    const doc = printOperation(aliased);
    expect(doc).toContain("item: product(handle: $h)");
    expect(doc).toContain("name: title");
  });
});
