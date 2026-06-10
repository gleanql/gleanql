import { describe, it, expect } from "vitest";
import { q } from "../src/builder.js";
import { mergeSelectionSets } from "../src/merger.js";
import { printOperation } from "../src/printer.js";
import { defineSchema } from "../src/schema.js";
import { mockSchema } from "./mock-schema.js";
import { validateDocument } from "./validate.js";

function product(...sets: ReturnType<typeof q.select>[]) {
  const merged = mergeSelectionSets(sets, mockSchema, { isRoot: false });
  return merged;
}

describe("selection merger", () => {
  it("dedupes identical scalar reads", () => {
    const merged = product(
      q.select("Product", { title: q.scalar("title") }),
      q.select("Product", { title: q.scalar("title") }),
    );
    const titles = merged.fields.filter((f) => f.name === "title");
    expect(titles).toHaveLength(1);
  });

  it("injects __typename and id for identity-bearing objects", () => {
    const merged = product(q.select("Product", { title: q.scalar("title") }));
    expect(merged.fields.map((f) => f.name)).toEqual(["__typename", "id", "title"]);
  });

  it("injects only __typename for objects without id", () => {
    const merged = mergeSelectionSets(
      [q.select("MoneyV2", { amount: q.scalar("amount") })],
      mockSchema,
    );
    expect(merged.fields.map((f) => f.name)).toEqual(["__typename", "amount"]);
  });

  it("auto-selects a type's configured key fields instead of id", () => {
    const schema = defineSchema({
      queryType: "Query",
      types: [
        { name: "Query", kind: "object", fields: { metafield: { name: "metafield", type: "Metafield" } } },
        {
          name: "Metafield",
          kind: "object",
          keys: ["namespace", "key"], // composite, not `id`
          fields: {
            namespace: { name: "namespace", type: "String", nonNull: true },
            key: { name: "key", type: "String", nonNull: true },
            value: { name: "value", type: "String", nonNull: true },
          },
        },
        { name: "String", kind: "scalar" },
      ],
    });
    const merged = mergeSelectionSets([q.select("Metafield", { value: q.scalar("value") })], schema);
    expect(merged.fields.map((f) => f.name)).toEqual(["__typename", "namespace", "key", "value"]);
  });

  it("merges nested object field reads (featuredImage.url + featuredImage.altText)", () => {
    const merged = product(
      q.select("Product", {
        featuredImage: q.field("featuredImage", {
          selection: q.select("Image", { url: q.scalar("url") }),
        }),
      }),
      q.select("Product", {
        featuredImage: q.field("featuredImage", {
          selection: q.select("Image", { altText: q.scalar("altText") }),
        }),
      }),
    );
    const fi = merged.fields.find((f) => f.name === "featuredImage");
    expect(fi?.selection?.fields.map((f) => f.name)).toEqual(["__typename", "url", "altText"]);
  });

  it("keeps order stable: __typename, id, then first-seen", () => {
    const merged = product(
      q.select("Product", {
        title: q.scalar("title"),
        availableForSale: q.scalar("availableForSale"),
      }),
    );
    expect(merged.fields.map((f) => f.name)).toEqual([
      "__typename",
      "id",
      "title",
      "availableForSale",
    ]);
  });

  it("aliases fields that conflict on arguments", () => {
    const merged = mergeSelectionSets(
      [
        q.select("Collection", {
          products: q.field("products", {
            args: q.args({ first: q.literal(12) }),
            selection: q.select("ProductConnection", {
              nodes: q.field("nodes", { selection: q.select("Product", { title: q.scalar("title") }) }),
            }),
          }),
        }),
        q.select("Collection", {
          products: q.field("products", {
            args: q.args({ first: q.literal(24) }),
            selection: q.select("ProductConnection", {
              nodes: q.field("nodes", { selection: q.select("Product", { title: q.scalar("title") }) }),
            }),
          }),
        }),
      ],
      mockSchema,
    );
    const productsFields = merged.fields.filter((f) => f.name === "products");
    expect(productsFields).toHaveLength(2);
    expect(productsFields.map((f) => f.alias).sort()).toEqual(["products_first12", "products_first24"]);

    // And it prints as valid GraphQL.
    const op = { kind: "query" as const, name: "Q", variables: [], selection: { ...merged, typeName: "Collection" } };
    // wrap under a root for validation
    const root = q.select("Query", {
      collection: q.field("collection", {
        args: q.args({ handle: q.var("h") }),
        selection: merged,
      }),
    });
    const printed = printOperation({ kind: "query", name: "Q", variables: [{ name: "h", type: "String!" }], selection: root });
    expect(validateDocument(printed)).toEqual([]);
    void op;
  });

  it("dedupes a repeated arg set into its existing alias (and merges its sub-selection)", () => {
    // Three reads of `products`: first:12, first:24, then first:12 AGAIN with a
    // different child field. The third must NOT mint a third alias — it dedupes
    // into `products_first12` and its `handle` read merges into that selection.
    const products = (first: number, child: "title" | "handle") =>
      q.select("Collection", {
        products: q.field("products", {
          args: q.args({ first: q.literal(first) }),
          selection: q.select("ProductConnection", {
            nodes: q.field("nodes", { selection: q.select("Product", { [child]: q.scalar(child) }) }),
          }),
        }),
      });
    const merged = mergeSelectionSets(
      [products(12, "title"), products(24, "title"), products(12, "handle")],
      mockSchema,
    );

    const variants = merged.fields.filter((f) => f.name === "products");
    expect(variants).toHaveLength(2);
    expect(variants.map((f) => f.alias).sort()).toEqual(["products_first12", "products_first24"]);

    const first12 = variants.find((f) => f.alias === "products_first12")!;
    const nodes = first12.selection?.fields.find((f) => f.name === "nodes");
    // Both contributions to the deduped variant survive, in first-seen order.
    expect(nodes?.selection?.fields.map((f) => f.name)).toEqual(["__typename", "id", "title", "handle"]);

    // And the deduped document still prints as valid GraphQL.
    const root = q.select("Query", {
      collection: q.field("collection", { args: q.args({ handle: q.var("h") }), selection: merged }),
    });
    const printed = printOperation({ kind: "query", name: "Q", variables: [{ name: "h", type: "String!" }], selection: root });
    expect(validateDocument(printed)).toEqual([]);
  });

  it("does not alias a single argumented field", () => {
    const merged = mergeSelectionSets(
      [
        q.select("Collection", {
          products: q.field("products", {
            args: q.args({ first: q.literal(12) }),
            selection: q.select("ProductConnection", {
              nodes: q.field("nodes", { selection: q.select("Product", { title: q.scalar("title") }) }),
            }),
          }),
        }),
      ],
      mockSchema,
    );
    const products = merged.fields.find((f) => f.name === "products");
    expect(products?.alias).toBeUndefined();
  });
});

describe("union / inline fragment merging", () => {
  /** A SearchResultItem contribution carrying one inline fragment. */
  function searchItem(onType: "Product" | "Collection", fields: Record<string, ReturnType<typeof q.scalar>>) {
    return q.select("SearchResultItem", {}, [q.inlineFragment(onType, q.select(onType, fields))]);
  }

  it("dedupes inline fragments on the same union member and merges their selections", () => {
    const merged = mergeSelectionSets(
      [
        searchItem("Product", { title: q.scalar("title") }),
        searchItem("Product", { handle: q.scalar("handle") }),
      ],
      mockSchema,
    );
    // One `... on Product`, not two — both reads merged inside it (with the
    // member's identity fields injected as usual).
    expect(merged.inlineFragments).toHaveLength(1);
    const frag = merged.inlineFragments![0]!;
    expect(frag.onType).toBe("Product");
    expect(frag.selection.fields.map((f) => f.name)).toEqual(["__typename", "id", "title", "handle"]);
    // The union itself gets only the `__typename` discriminator (unions have no `id`).
    expect(merged.fields.map((f) => f.name)).toEqual(["__typename"]);
  });

  it("keeps fragments on different members side by side and prints valid GraphQL", () => {
    const merged = mergeSelectionSets(
      [
        searchItem("Product", { title: q.scalar("title") }),
        searchItem("Collection", { title: q.scalar("title") }),
      ],
      mockSchema,
    );
    // First-seen order, one fragment per member.
    expect(merged.inlineFragments?.map((f) => f.onType)).toEqual(["Product", "Collection"]);

    // The printed document is real GraphQL: union fields are only reachable
    // through inline fragments, so wrap under Query.search.nodes and validate.
    const root = q.select("Query", {
      search: q.field("search", {
        args: q.args({ query: q.var("q") }),
        selection: q.select("SearchResultConnection", {
          nodes: q.field("nodes", { selection: merged }),
        }),
      }),
    });
    const printed = printOperation({ kind: "query", name: "Search", variables: [{ name: "q", type: "String!" }], selection: root });
    expect(printed).toContain("... on Product");
    expect(printed).toContain("... on Collection");
    expect(validateDocument(printed)).toEqual([]);
  });
});
