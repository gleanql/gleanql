import { describe, it, expect, vi } from "vitest";
import { defineSchema, type SchemaModel, type SelectionSet } from "@gleanql/core";
import type { CompiledOperation, GraphClientAdapter, GraphResult } from "@gleanql/client";
import { createGraphIntegration, type GraphRouteContext, type RequestInfo } from "../src/index.js";
import { splitDeferredRoots } from "../src/paginate.js";

// A union-returning schema: `search(query:)` (object root → connection) and
// `nodes(ids:)` (list root) — the two shapes a two-sweep read can take.
const schema: SchemaModel = defineSchema({
  queryType: "Query",
  types: [
    {
      name: "Query",
      kind: "object",
      fields: {
        search: { name: "search", type: "SearchResultConnection", args: [{ name: "query", type: "String!" }] },
        nodes: { name: "nodes", type: "SearchResultItem", list: true, nonNull: true, args: [{ name: "ids", type: "[ID!]!" }] },
        shop: { name: "shop", type: "Shop" },
      },
    },
    { name: "SearchResultConnection", kind: "object", fields: { nodes: { name: "nodes", type: "SearchResultItem", list: true, nonNull: true } } },
    { name: "SearchResultItem", kind: "union", possibleTypes: ["Product", "Collection"] },
    { name: "Product", kind: "object", fields: { id: { name: "id", type: "ID", nonNull: true }, title: { name: "title", type: "String", nonNull: true } } },
    { name: "Collection", kind: "object", fields: { id: { name: "id", type: "ID", nonNull: true }, title: { name: "title", type: "String", nonNull: true } } },
    { name: "Shop", kind: "object", fields: { name: { name: "name", type: "String", nonNull: true } } },
    { name: "String", kind: "scalar" },
    { name: "ID", kind: "scalar" },
  ],
});

const unionNodes: SelectionSet = {
  typeName: "SearchResultItem",
  fields: [{ name: "__typename" }],
  inlineFragments: [
    { onType: "Product", selection: { typeName: "Product", fields: [{ name: "__typename" }, { name: "id" }, { name: "title" }] } },
    { onType: "Collection", selection: { typeName: "Collection", fields: [{ name: "__typename" }, { name: "id" }, { name: "title" }] } },
  ],
};

// A pure two-sweep route over the object root `search(query: $search_query)`.
const SearchRoute: CompiledOperation<GraphRouteContext> = {
  name: "SearchRoute",
  kind: "query",
  document:
    "query SearchRoute($search_query: String!) { search(query: $search_query) { __typename nodes { __typename ... on Product { __typename id title } ... on Collection { __typename id title } } } }",
  hash: "d1",
  variables: () => ({}), // deferred → factory omits search_query
  selection: {
    typeName: "Query",
    fields: [
      {
        name: "search",
        args: [["query", { kind: "var", name: "search_query" }]],
        selection: {
          typeName: "SearchResultConnection",
          fields: [{ name: "__typename" }, { name: "nodes", selection: unionNodes }],
        },
      },
    ],
  },
  deferred: true,
  runtimeVars: ["search_query"],
};

// A pure two-sweep route over the LIST root `nodes(ids: $nodes_ids)`.
const NodesRoute: CompiledOperation<GraphRouteContext> = {
  name: "NodesRoute",
  kind: "query",
  document:
    "query NodesRoute($nodes_ids: [ID!]!) { nodes(ids: $nodes_ids) { __typename ... on Product { __typename id title } ... on Collection { __typename id title } } }",
  hash: "d2",
  variables: () => ({}),
  selection: {
    typeName: "Query",
    fields: [{ name: "nodes", args: [["ids", { kind: "var", name: "nodes_ids" }]], selection: unionNodes }],
  },
  deferred: true,
  runtimeVars: ["nodes_ids"],
};

const items = [
  { __typename: "Product", id: "p1", title: "Prod 1" },
  { __typename: "Collection", id: "c1", title: "Coll 1" },
];

function makeAdapter() {
  const execute = vi.fn(async (_op, vars: Record<string, unknown>): Promise<GraphResult<unknown>> => {
    if ("ids" in vars) return { data: { nodes: items } };
    return { data: { search: { __typename: "SearchResultConnection", nodes: items } } };
  });
  return { adapter: { execute } as GraphClientAdapter, execute };
}

function makeRequest(url: string, params: Record<string, string> = {}): RequestInfo {
  return { request: new Request(url), params, ctx: {} };
}

/**
 * Run a read chain the way React's Suspense would: retry the WHOLE function on a
 * thrown promise (a deferred root suspends once, then resolves from cache).
 */
async function settle<T>(read: () => T): Promise<T> {
  for (let i = 0; i < 8; i++) {
    try {
      return read();
    } catch (thrown) {
      if (thrown instanceof Promise) {
        await thrown;
        continue;
      }
      throw thrown;
    }
  }
  return read();
}

describe("two-sweep deferred reads", () => {
  it("does NOT eagerly fetch a pure-deferred route during preload", async () => {
    const { adapter, execute } = makeAdapter();
    const integration = createGraphIntegration({ schema, operations: { SearchRoute }, adapter });
    await integration.preload(makeRequest("https://shop.test/search"), "SearchRoute");
    expect(execute).not.toHaveBeenCalled();
  });

  it("executes an object root at the call-site with render-time args, then narrows", async () => {
    const { adapter, execute } = makeAdapter();
    const integration = createGraphIntegration({ schema, operations: { SearchRoute }, adapter });
    const ri = makeRequest("https://shop.test/search");
    await integration.preload(ri, "SearchRoute");
    const graph = integration.getGraph(ri);

    // The read chain suspends once, then resolves from the seeded cache.
    const labels = await settle(() => {
      const conn = graph.search!({ query: "shoes" }) as any;
      return (conn.nodes as any[]).map((n) =>
        n.__typename === "Product" ? `P:${n.title}` : `C:${n.title}`,
      );
    });
    expect(labels).toEqual(["P:Prod 1", "C:Coll 1"]);
    // Executed once, with the render-time arg (not from a ctx factory).
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.anything(), { query: "shoes" }, expect.anything());
  });

  it("executes a LIST root (nodes(ids:)) and wraps each item", async () => {
    const { adapter, execute } = makeAdapter();
    const integration = createGraphIntegration({ schema, operations: { NodesRoute }, adapter });
    const ri = makeRequest("https://shop.test/nodes");
    await integration.preload(ri, "NodesRoute");
    const graph = integration.getGraph(ri);

    const products = await settle(() => {
      const list = graph.nodes!({ ids: ["p1", "c1"] }) as any[];
      return list.filter((n) => n.__typename === "Product").map((n) => n.title);
    });
    expect(products).toEqual(["Prod 1"]);
    expect(execute).toHaveBeenCalledWith(expect.anything(), { ids: ["p1", "c1"] }, expect.anything());
  });

  it("dedupes concurrent identical reads and serves repeats from cache", async () => {
    const { adapter, execute } = makeAdapter();
    const integration = createGraphIntegration({ schema, operations: { SearchRoute }, adapter });
    const ri = makeRequest("https://shop.test/search");
    await integration.preload(ri, "SearchRoute");
    const graph = integration.getGraph(ri);

    await settle(() => (graph.search!({ query: "shoes" }) as any).nodes.length);
    // A second read of the same root+args is a cache hit — no extra fetch.
    const again = graph.search!({ query: "shoes" }) as any;
    expect(again.nodes.length).toBe(2);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("splitDeferredRoots", () => {
  it("returns no eager op for a pure two-sweep route", () => {
    const split = splitDeferredRoots(SearchRoute, new Set(["search_query"]));
    expect([...split.deferredRoots]).toEqual(["search"]);
    expect(split.eager).toBeUndefined();
  });

  it("prunes a mixed op to only its ctx-derivable roots", () => {
    const mixed: CompiledOperation<GraphRouteContext> = {
      ...SearchRoute,
      name: "Mixed",
      selection: {
        typeName: "Query",
        fields: [
          ...(SearchRoute.selection!.fields as any[]), // deferred `search`
          { name: "shop", selection: { typeName: "Shop", fields: [{ name: "__typename" }, { name: "name" }] } }, // eager
        ],
      },
    };
    const split = splitDeferredRoots(mixed, new Set(["search_query"]));
    expect([...split.deferredRoots]).toEqual(["search"]);
    expect(split.eager?.document).toContain("shop");
    expect(split.eager?.document).not.toContain("search(");
  });
});
