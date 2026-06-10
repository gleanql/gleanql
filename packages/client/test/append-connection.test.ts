import { describe, it, expect } from "vitest";
import { GraphRuntime } from "../src/runtime.js";
import type { GraphRef } from "../src/cache.js";

// `appendConnection` is the low-level pagination primitive: concat a fetched page
// onto a cached connection. It's schema-agnostic — the app fetches the next page
// however it wants and hands the page object here. (There is deliberately no
// built-in `loadMore`/cursor convention baked into the compiler.)
describe("runtime.appendConnection", () => {
  const keyOf = (_t: string, o: Record<string, unknown>) => (o.id != null ? String(o.id) : undefined);
  const value = (rt: GraphRuntime, ref: GraphRef, key: string): unknown => {
    const got = rt.cache.getField(ref, key);
    return got.status === "ready" ? got.value : undefined;
  };

  it("concats new nodes after existing ones and replaces pageInfo", () => {
    const runtime = new GraphRuntime({ fetchMissing: async () => [], keyOf });
    const roots = runtime.seedResult({
      collection: {
        __typename: "Collection",
        id: "c1",
        products: {
          __typename: "ProductConnection",
          nodes: [
            { __typename: "Product", id: "p1", title: "One" },
            { __typename: "Product", id: "p2", title: "Two" },
          ],
          pageInfo: { __typename: "PageInfo", hasNextPage: true, endCursor: "cursor-2" },
        },
      },
    });
    const collectionRef = roots.collection as GraphRef;
    const connRef = value(runtime, collectionRef, "products") as GraphRef;
    expect((value(runtime, connRef, "nodes") as unknown[]).length).toBe(2);

    runtime.appendConnection(connRef, {
      __typename: "ProductConnection",
      nodes: [
        { __typename: "Product", id: "p3", title: "Three" },
        { __typename: "Product", id: "p4", title: "Four" },
      ],
      pageInfo: { __typename: "PageInfo", hasNextPage: false, endCursor: "cursor-4" },
    });

    const nodes = value(runtime, connRef, "nodes") as GraphRef[];
    expect(nodes.map((n) => n.id)).toEqual(["p1", "p2", "p3", "p4"]);

    const piRef = value(runtime, connRef, "pageInfo") as GraphRef;
    expect(value(runtime, piRef, "endCursor")).toBe("cursor-4");
    expect(value(runtime, piRef, "hasNextPage")).toBe(false);

    // Appended entities are normalized + globally readable.
    expect(value(runtime, { __typename: "Product", id: "p3" }, "title")).toBe("Three");
  });

  it("appends onto an empty/absent connection and tolerates a page without pageInfo", () => {
    const runtime = new GraphRuntime({ fetchMissing: async () => [], keyOf });
    const connRef: GraphRef = { path: "Query.feed" };
    runtime.appendConnection(connRef, { nodes: [{ __typename: "Item", id: "i1" }] });
    expect((value(runtime, connRef, "nodes") as GraphRef[]).map((n) => n.id)).toEqual(["i1"]);
    expect(value(runtime, connRef, "pageInfo")).toBeUndefined();
  });
});
