import { describe, it, expect } from "vitest";
import { renderDevtoolsHtml } from "../src/devtools.js";
import type { OperationArtifact } from "@gleanql/core";

const op = (over: Partial<OperationArtifact> = {}): OperationArtifact =>
  ({
    name: "ProductRoute",
    kind: "query",
    document: 'query ProductRoute($handle: String!) {\n  product(handle: $handle) {\n    title\n  }\n}\n',
    hash: "a".repeat(64),
    variablesFactory: { exportName: "getProductRouteVariables", source: "" },
    readMap: { BuyBox: ["Product.title", "Product.priceRange.minVariantPrice.amount"] },
    selection: { typeName: "Query", fields: [] },
    source: "src/app/pages/ProductPage.tsx",
    stats: { fieldCount: 7, rootCount: 1, connectionCount: 0 },
    ...over,
  }) as OperationArtifact;

describe("renderDevtoolsHtml", () => {
  it("renders each operation's document, hash, stats and read map", () => {
    const html = renderDevtoolsHtml({ ProductRoute: op() }, []);
    expect(html).toContain("<h2>ProductRoute</h2>");
    expect(html).toContain('class="kind query"');
    expect(html).toContain("a".repeat(16) + "…"); // shortened persisted hash
    expect(html).toContain("7 fields · 1 root · 0 connections");
    expect(html).toContain("product(handle: $handle)");
    expect(html).toContain("Product.priceRange.minVariantPrice.amount"); // read-map tree
    expect(html).toContain("src/app/pages/ProductPage.tsx");
  });

  it("escapes HTML in documents and diagnostics", () => {
    const html = renderDevtoolsHtml(
      { Evil: op({ name: "Evil", document: 'query Evil { a(b: "<script>") }' }) },
      ['route.tsx:3 [unsupported-list-flow] Cannot analyze <Foo />'],
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("1 compiler diagnostic(s)");
    expect(html).toContain("&lt;Foo /&gt;");
  });

  it("surfaces large-operation warnings from summarizeOperation", () => {
    const html = renderDevtoolsHtml(
      { Big: op({ name: "Big", stats: { fieldCount: 150, rootCount: 2, connectionCount: 1 } }) },
      [],
    );
    expect(html).toContain('class="warn"');
    expect(html).toContain("150 fields");
  });

  it("renders an empty state without operations", () => {
    const html = renderDevtoolsHtml({}, []);
    expect(html).toContain("0 compiled operation(s)");
    expect(html).not.toContain('class="diags"');
  });
});
