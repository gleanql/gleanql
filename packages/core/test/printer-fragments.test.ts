import { describe, it, expect } from "vitest";
import { q } from "../src/builder.js";
import { printOperation } from "../src/printer.js";
import { validateDocument } from "./validate.js";

/** A Product selection of 3 fields (above the default minSelections). */
const productSel = () =>
  q.select("Product", {
    __typename: q.scalar("__typename"),
    id: q.scalar("id"),
    title: q.scalar("title"),
  });

const pair = (selection = productSel()) =>
  q.query(
    "ProductPair",
    q.select("Query", {
      a: q.field("product", { args: [["handle", q.literal("a")]], selection }),
      b: q.field("product", { args: [["handle", q.literal("b")]], selection }),
    }),
  );

describe("printer: named fragment extraction (opt-in)", () => {
  it("is OFF by default — output has no fragments (byte-compatibility)", () => {
    const doc = printOperation(pair());
    expect(doc).not.toContain("fragment ");
    expect(doc).not.toContain("...");
  });

  it("extracts a repeated selection into one fragment, spread at each site", () => {
    const doc = printOperation(pair(), { fragments: true });

    expect(doc).toContain('a: product(handle: "a") {\n    ...ProductFields\n  }');
    expect(doc).toContain('b: product(handle: "b") {\n    ...ProductFields\n  }');
    expect(doc).toContain("fragment ProductFields on Product {\n  __typename\n  id\n  title\n}");
    // The selection body appears exactly once (in the fragment definition).
    expect(doc.match(/\btitle\b/g)).toHaveLength(1);
    expect(validateDocument(doc)).toEqual([]);
  });

  it("leaves a selection used only once inline", () => {
    const op = q.query(
      "OneProduct",
      q.select("Query", {
        product: q.field("product", { args: [["handle", q.literal("a")]], selection: productSel() }),
      }),
    );
    const doc = printOperation(op, { fragments: true });
    expect(doc).not.toContain("fragment ");
    expect(validateDocument(doc)).toEqual([]);
  });

  it("skips small selections (default minSelections=3 keeps `__typename id` pairs inline)", () => {
    const tiny = q.select("Product", {
      __typename: q.scalar("__typename"),
      id: q.scalar("id"),
    });
    const doc = printOperation(pair(tiny), { fragments: true });
    expect(doc).not.toContain("fragment ");
    expect(validateDocument(doc)).toEqual([]);
  });

  it("honors a custom minSelections", () => {
    const tiny = q.select("Product", {
      __typename: q.scalar("__typename"),
      id: q.scalar("id"),
    });
    const doc = printOperation(pair(tiny), { fragments: { minSelections: 2 } });
    expect(doc).toContain("fragment ProductFields on Product");
    expect(validateDocument(doc)).toEqual([]);
  });

  it("a fragment body spreads other repeated selections (fragment-in-fragment)", () => {
    const imageSel = q.select("Image", {
      __typename: q.scalar("__typename"),
      url: q.scalar("url"),
      altText: q.scalar("altText"),
    });
    const withImage = q.select("Product", {
      __typename: q.scalar("__typename"),
      id: q.scalar("id"),
      title: q.scalar("title"),
      featuredImage: q.field("featuredImage", { selection: imageSel }),
    });
    const doc = printOperation(pair(withImage), { fragments: true });

    expect(doc).toContain("fragment ProductFields on Product");
    expect(doc).toContain("fragment ImageFields on Image");
    expect(doc).toContain("...ImageFields"); // inside ProductFields, not inlined twice
    expect(doc.match(/\burl\b/g)).toHaveLength(1);
    expect(validateDocument(doc)).toEqual([]);
  });

  it("disambiguates two different repeated selections on the same type", () => {
    const byTitle = productSel();
    const byHandle = q.select("Product", {
      __typename: q.scalar("__typename"),
      id: q.scalar("id"),
      handle: q.scalar("handle"),
    });
    const op = q.query(
      "FourProducts",
      q.select("Query", {
        a: q.field("product", { args: [["handle", q.literal("a")]], selection: byTitle }),
        b: q.field("product", { args: [["handle", q.literal("b")]], selection: byTitle }),
        c: q.field("product", { args: [["handle", q.literal("c")]], selection: byHandle }),
        d: q.field("product", { args: [["handle", q.literal("d")]], selection: byHandle }),
      }),
    );
    const doc = printOperation(op, { fragments: true });
    expect(doc).toContain("fragment ProductFields on Product");
    expect(doc).toContain("fragment ProductFields2 on Product");
    expect(validateDocument(doc)).toEqual([]);
  });
});
