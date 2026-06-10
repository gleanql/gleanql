import { describe, it, expect } from "vitest";
import type { SelectionSet } from "@gleanql/core";
import { buildComponentOperation } from "../src/glue-client.js";

// The compiled ProductPage operation + the per-component read-map the compiler emits.
const selection: SelectionSet = {
  typeName: "Query",
  fields: [
    {
      name: "product",
      args: [["handle", { kind: "var", name: "handle" }]],
      selection: {
        typeName: "Product",
        fields: [
          { name: "__typename" },
          { name: "id" },
          { name: "title" },
          { name: "views" },
          { name: "featuredImage", selection: { typeName: "Image", fields: [{ name: "__typename" }, { name: "url" }] } },
        ],
      },
    },
  ],
};
const op = {
  name: "ProductPage",
  document: "query ProductPage($handle: String!) {\n  product(handle: $handle) {\n    __typename\n    id\n    title\n    views\n  }\n}\n",
  selection,
  readMap: {
    RefreshViews: ["Product.views"],
    Hero: ["Product.featuredImage.url"],
  },
};

describe("buildComponentOperation (component-auto refresh)", () => {
  it("prunes to exactly the component's read-map (+ identity + root args)", () => {
    const built = buildComponentOperation(op, "RefreshViews");
    expect(built).toBeDefined();
    const doc = built!.document;
    expect(doc).toContain("product(handle: $handle)"); // root + args preserved
    expect(doc).toContain("$handle: String!"); // variable still declared
    expect(doc).toContain("views");
    expect(doc).toContain("__typename");
    expect(doc).toContain("id"); // identity kept so the result normalizes
    expect(doc).not.toContain("title"); // not read by this component
    expect(doc).not.toContain("featuredImage"); // read by Hero, not RefreshViews
    expect(built!.name).toBe("ProductPage_RefreshViews");
  });

  it("follows a nested read path, keeping the intermediate object's identity", () => {
    const doc = buildComponentOperation(op, "Hero")!.document;
    expect(doc).toContain("featuredImage");
    expect(doc).toContain("url");
    expect(doc).not.toContain("views");
    expect(doc).not.toContain("title");
  });

  it("returns undefined when the component isn't in the read-map", () => {
    expect(buildComponentOperation(op, "Unknown")).toBeUndefined();
    expect(buildComponentOperation({ name: "X", document: "query X { a }" }, "C")).toBeUndefined();
  });
});
