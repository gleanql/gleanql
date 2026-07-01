import { describe, it, expect, vi } from "vitest";
import { defineSchema, type SchemaModel, type SelectionSet } from "@gleanql/core";
import type { CompiledOperation, GraphClientAdapter, GraphResult } from "@gleanql/client";
import { createGraphIntegration, createGraphProxy, GraphRuntime, type GraphRouteContext, type RequestInfo } from "../src/index.js";
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

// A deferred root read is isomorphic: React reads it synchronously via Suspense
// (covered above), and a plain server handler (webhook/job/proxy) `await`s it — no
// Suspense loop, no `settle()`. This is the "no raw graphql() in handlers" path.
describe("await (non-React server handler) deferred reads", () => {
  it("awaits an OBJECT root, then reads its fields as cache hits (no thrown promise)", async () => {
    const { adapter, execute } = makeAdapter();
    const integration = createGraphIntegration({ schema, operations: { SearchRoute }, adapter });
    const ri = makeRequest("https://shop.test/search");
    await integration.preload(ri, "SearchRoute");
    const graph = integration.getGraph(ri);

    // A bare `await` — the way a handler would write it. No settle() retry loop.
    const conn = (await graph.search!({ query: "shoes" })) as any;
    const labels = (conn.nodes as any[]).map((n) =>
      n.__typename === "Product" ? `P:${n.title}` : `C:${n.title}`,
    );
    expect(labels).toEqual(["P:Prod 1", "C:Coll 1"]);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(expect.anything(), { query: "shoes" }, expect.anything());
  });

  it("awaits a LIST root to a real array (map/filter directly, no Suspense)", async () => {
    const { adapter, execute } = makeAdapter();
    const integration = createGraphIntegration({ schema, operations: { NodesRoute }, adapter });
    const ri = makeRequest("https://shop.test/nodes");
    await integration.preload(ri, "NodesRoute");
    const graph = integration.getGraph(ri);

    const list = (await graph.nodes!({ ids: ["p1", "c1"] })) as any[];
    expect(Array.isArray(list)).toBe(true);
    expect(list.filter((n) => n.__typename === "Product").map((n) => n.title)).toEqual(["Prod 1"]);
    expect(execute).toHaveBeenCalledWith(expect.anything(), { ids: ["p1", "c1"] }, expect.anything());
  });

  it("dedupes repeated awaits of the same root+args to a single fetch", async () => {
    const { adapter, execute } = makeAdapter();
    const integration = createGraphIntegration({ schema, operations: { SearchRoute }, adapter });
    const ri = makeRequest("https://shop.test/search");
    await integration.preload(ri, "SearchRoute");
    const graph = integration.getGraph(ri);

    const a = (await graph.search!({ query: "shoes" })) as any;
    const b = (await graph.search!({ query: "shoes" })) as any;
    expect(a.nodes.length).toBe(2);
    expect(b.nodes.length).toBe(2);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("dedupes CONCURRENT awaits (Promise.all) to a single in-flight fetch", async () => {
    const { adapter, execute } = makeAdapter();
    const integration = createGraphIntegration({ schema, operations: { SearchRoute }, adapter });
    const ri = makeRequest("https://shop.test/search");
    await integration.preload(ri, "SearchRoute");
    const graph = integration.getGraph(ri);

    const [a, b] = (await Promise.all([
      graph.search!({ query: "shoes" }) as Promise<any>,
      graph.search!({ query: "shoes" }) as Promise<any>,
    ])) as [any, any];
    expect(a.nodes.length).toBe(2);
    expect(b.nodes.length).toBe(2);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("surfaces a fetch error as a rejected await (not a thrown Suspense promise)", async () => {
    const execute = vi.fn(async (): Promise<GraphResult<unknown>> => {
      throw new Error("network down");
    });
    const integration = createGraphIntegration({ schema, operations: { SearchRoute }, adapter: { execute } as GraphClientAdapter });
    const ri = makeRequest("https://shop.test/search");
    await integration.preload(ri, "SearchRoute");
    const graph = integration.getGraph(ri);

    await expect((graph.search!({ query: "shoes" }) as Promise<unknown>)).rejects.toThrow("network down");
  });
});

// The `then`-guard: a plain graph proxy (eager/seeded root, or any nested object)
// must NOT look like a thenable, or `await glean.shop()` / returning a graph value
// from an async handler would probe `.then` as a missing field and suspend outside
// React. This is what makes `await` uniform across eager and deferred roots.
describe("graph proxy is not a thenable (the await/return guard)", () => {
  it("exposes `.then` as undefined and awaits to itself, fields still readable", async () => {
    const runtime = new GraphRuntime({ fetchMissing: async () => [] });
    const binding = { schema, getRuntime: () => runtime };
    const ref = { __typename: "Product", id: "p1" } as any;
    runtime.seed(ref, { __typename: "Product", id: "p1", title: "Prod 1" });
    const proxy = createGraphProxy(binding, ref, "Product") as any;

    expect(proxy.then).toBeUndefined();
    const awaited = await proxy; // must not throw a Suspense promise nor hang
    expect(awaited).toBe(proxy);
    expect(awaited.title).toBe("Prod 1");
  });
});

// A deferred root's SYNC (React) value must keep the shape of the value it
// materializes to — a list root is a real array (`Array.isArray`), a singular root
// is non-enumerable — and must never leak its internal `then` into enumeration /
// spread / JSON, matching every other graph read.
describe("deferred root value shape (array + enumeration parity)", () => {
  it("a deferred LIST root reads as a real array and hides its internal `then`", async () => {
    const { adapter } = makeAdapter();
    const integration = createGraphIntegration({ schema, operations: { NodesRoute }, adapter });
    const ri = makeRequest("https://shop.test/nodes");
    await integration.preload(ri, "NodesRoute");
    const graph = integration.getGraph(ri);

    const nodes = graph.nodes!({ ids: ["p1", "c1"] });
    expect(Array.isArray(nodes)).toBe(true); // was false — Proxy over { then } — before the array target
    expect(Object.keys(nodes as object)).not.toContain("then"); // internal then not enumerated
    expect(typeof (nodes as any).then).toBe("function"); // still awaitable
  });

  it("a deferred SINGULAR root does not leak `then` via keys/spread but stays awaitable", async () => {
    const { adapter } = makeAdapter();
    const integration = createGraphIntegration({ schema, operations: { SearchRoute }, adapter });
    const ri = makeRequest("https://shop.test/search");
    await integration.preload(ri, "SearchRoute");
    const graph = integration.getGraph(ri);

    const conn = graph.search!({ query: "shoes" });
    expect(Object.keys(conn as object)).toEqual([]); // parity with the main graph proxy (ownKeys [])
    expect({ ...(conn as object) }).toEqual({}); // spreading is a diagnostic — no `then`
    expect(typeof (conn as any).then).toBe("function");
  });

  it("memoizes the materialized value so repeated sync reads keep stable identity", async () => {
    const { adapter } = makeAdapter();
    const integration = createGraphIntegration({ schema, operations: { NodesRoute }, adapter });
    const ri = makeRequest("https://shop.test/nodes");
    await integration.preload(ri, "NodesRoute");
    const graph = integration.getGraph(ri);

    const nodes = graph.nodes!({ ids: ["p1", "c1"] }) as any[];
    await settle(() => nodes.length); // seed via a sync read
    expect(nodes[0]).toBe(nodes[0]); // same proxy instance, not re-wrapped per access
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
