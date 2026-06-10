import { describe, it, expect } from "vitest";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { defineSchema } from "@gleanql/core";
import { createGraphClient } from "../src/glue-client.js";
import { buildTestGraph } from "../src/testing.js";

/**
 * Islands server-render WARM: during the SSR pass the private scope is unset,
 * and `serverActive` supplies the request's preloaded graph — roots included —
 * so `useGlean()` binds and renders data instead of the pre-data fallback.
 * (vitest runs in node here: `typeof window === "undefined"`, the real SSR
 * condition.)
 */

const schema = defineSchema({
  queryType: "Query",
  types: [
    {
      name: "Query",
      kind: "object",
      fields: { product: { name: "product", type: "Product", args: [{ name: "handle", type: "String!" }] } },
    },
    {
      name: "Product",
      kind: "object",
      fields: {
        id: { name: "id", type: "ID", nonNull: true },
        title: { name: "title", type: "String" },
      },
    },
  ],
});

function makeClient(serverActive?: () => any) {
  return createGraphClient({
    schema,
    operations: {},
    endpoint: "/graphql",
    ...(serverActive ? { serverActive } : {}),
  });
}

function Island({ useGlean }: { useGlean: (c?: string) => any }) {
  const glean = useGlean();
  const product = glean?.product({ handle: "mug" });
  return createElement("h1", null, product ? product.title : "loading…");
}

describe("useGlean during the SSR pass", () => {
  it("renders warm inside <GraphHydrator payload> — the context carrier", () => {
    const { payload } = buildTestGraph({
      schema,
      data: { product: { __typename: "Product", id: "p1", title: "Aurora Mug" } },
    });
    const client = makeClient();
    const html = renderToString(
      createElement(client.GraphHydrator, { payload }, createElement(Island, { useGlean: client.useGlean })),
    );
    expect(html).toContain("Aurora Mug");
    expect(html).not.toContain("loading…");
  });

  it("renders the fallback inside a payload-less hydrator", () => {
    const client = makeClient();
    const html = renderToString(
      createElement(client.GraphHydrator, { payload: undefined }, createElement(Island, { useGlean: client.useGlean })),
    );
    expect(html).toContain("loading…");
  });

  it("renders warm when serverActive supplies the request graph", () => {
    const { glean: _g, runtime, roots } = buildTestGraph({
      schema,
      data: { product: { __typename: "Product", id: "p1", title: "Aurora Mug" } },
    });
    const client = makeClient(() => ({ runtime, graph: _g, roots }));
    const html = renderToString(createElement(Island, { useGlean: client.useGlean }));
    expect(html).toContain("Aurora Mug");
    expect(html).not.toContain("loading…");
  });

  it("renders the fallback when the route preloaded nothing", () => {
    const client = makeClient(() => undefined);
    const html = renderToString(createElement(Island, { useGlean: client.useGlean }));
    expect(html).toContain("loading…");
  });

  it("renders the fallback without a serverActive resolver (pre-fix behavior preserved)", () => {
    const client = makeClient();
    const html = renderToString(createElement(Island, { useGlean: client.useGlean }));
    expect(html).toContain("loading…");
  });
});
