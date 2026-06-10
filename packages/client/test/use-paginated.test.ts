import { describe, it, expect } from "vitest";
import { defineSchema, type SelectionSet } from "@gleanql/core";
import { buildPageOperation, paginateConnection } from "../src/glue-client.js";
import { GraphRuntime } from "../src/runtime.js";
import { bindGraph } from "../src/proxy.js";
import type { GraphClientAdapter } from "../src/adapter.js";
import type { GraphPagePointer } from "../src/serialize.js";

const schema = defineSchema({
  queryType: "Query",
  types: [
    { name: "Query", kind: "object", fields: { collection: { name: "collection", type: "Collection", args: [{ name: "handle", type: "String!" }] } } },
    {
      name: "Collection",
      kind: "object",
      fields: {
        id: { name: "id", type: "ID", nonNull: true },
        products: { name: "products", type: "ProductConnection", args: [{ name: "first", type: "Int" }, { name: "after", type: "String" }] },
      },
    },
    {
      name: "ProductConnection",
      kind: "object",
      fields: {
        nodes: { name: "nodes", type: "Product", list: true, nonNull: true },
        pageInfo: { name: "pageInfo", type: "PageInfo", nonNull: true },
      },
    },
    { name: "PageInfo", kind: "object", keys: [], fields: { hasNextPage: { name: "hasNextPage", type: "Boolean", nonNull: true }, endCursor: { name: "endCursor", type: "String" } } },
    { name: "Product", kind: "object", fields: { id: { name: "id", type: "ID", nonNull: true }, title: { name: "title", type: "String" } } },
    { name: "String", kind: "scalar" },
    { name: "Boolean", kind: "scalar" },
    { name: "Int", kind: "scalar" },
    { name: "ID", kind: "scalar" },
  ],
});

// A compiled collection page: collection(handle) -> products(first) with the user's
// own pageInfo read (no auto-injection — the user read endCursor for the button).
const selection: SelectionSet = {
  typeName: "Query",
  fields: [
    {
      name: "collection",
      args: [["handle", { kind: "var", name: "handle" }]],
      selection: {
        typeName: "Collection",
        fields: [
          { name: "__typename" },
          { name: "id" },
          {
            name: "products",
            args: [["first", { kind: "literal", value: 2 }]],
            selection: {
              typeName: "ProductConnection",
              fields: [
                { name: "__typename" },
                { name: "nodes", selection: { typeName: "Product", fields: [{ name: "__typename" }, { name: "id" }, { name: "title" }] } },
                { name: "pageInfo", selection: { typeName: "PageInfo", fields: [{ name: "__typename" }, { name: "hasNextPage" }, { name: "endCursor" }] } },
              ],
            },
          },
        ],
      },
    },
  ],
};
const op = {
  name: "CollectionPage",
  document: "query CollectionPage($handle: String!) {\n  collection(handle: $handle) { __typename id products(first: 2) { __typename nodes { __typename id title } pageInfo { __typename hasNextPage endCursor } } }\n}\n",
  selection,
};
const trail = [
  { name: "collection", args: { handle: "all" } },
  { name: "products", args: { first: 2 } },
];

describe("buildPageOperation", () => {
  it("overrides the connection args with caller vars, keeping the path + node selection", () => {
    const built = buildPageOperation(op, trail, { after: "cursor-2" }, schema);
    expect(built).toBeDefined();
    const doc = built!.document;
    expect(doc).toContain("collection(handle: $handle)"); // ancestor path + arg kept
    expect(doc).toContain("$handle: String!"); // ancestor var still declared
    expect(doc).toContain("products(first: 2, after: $after)"); // literal first kept, after injected as var
    expect(doc).toContain("$after: String"); // arg var declared with schema type
    expect(doc).toContain("nodes");
    expect(doc).toContain("endCursor");
    expect(built!.name).toBe("CollectionPage_page");
  });

  it("returns undefined when the trail doesn't resolve in the operation", () => {
    expect(buildPageOperation(op, [{ name: "nope" }], {}, schema)).toBeUndefined();
    expect(buildPageOperation({ name: "X", document: "query X { a }" }, [{ name: "a" }], {}, schema)).toBeUndefined();
  });
});

describe("paginateConnection (the non-hook core of usePaginated)", () => {
  const keyOf = (_t: string, o: Record<string, unknown>) => (o.id != null ? String(o.id) : undefined);
  const operations = { CollectionPage: op };
  const page: GraphPagePointer = { operationName: "CollectionPage", variables: { handle: "all" }, roots: {}, context: {} };

  /** A runtime seeded with page 1 (p1, p2), plus a bound graph to read the connection value. */
  function setup() {
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
    const graph = bindGraph({ schema, getRuntime: () => runtime, roots }) as Record<
      string,
      (a?: unknown) => Record<string, (a?: unknown) => unknown>
    >;
    const connection = () => graph.collection!({ handle: "all" }).products!({ first: 2 });
    return { runtime, connection };
  }

  /** An adapter that returns one page and records the request it received. */
  function stubAdapter(pageData: { nodes: unknown[]; pageInfo?: unknown }): { adapter: GraphClientAdapter; seen: { document?: string; variables?: Record<string, unknown> } } {
    const seen: { document?: string; variables?: Record<string, unknown> } = {};
    const adapter: GraphClientAdapter = {
      async execute(operation, variables) {
        seen.document = operation.document;
        seen.variables = variables as Record<string, unknown>;
        return { data: { collection: { __typename: "Collection", id: "c1", products: { __typename: "ProductConnection", ...pageData } } } } as never;
      },
    };
    return { adapter, seen };
  }

  it("sends the caller's cursor arg and concats the page by default", async () => {
    const { runtime, connection } = setup();
    const { adapter, seen } = stubAdapter({
      nodes: [
        { __typename: "Product", id: "p3", title: "Three" },
        { __typename: "Product", id: "p4", title: "Four" },
      ],
      pageInfo: { __typename: "PageInfo", hasNextPage: false, endCursor: "cursor-4" },
    });

    const res = await paginateConnection({ connection: connection(), args: { after: "cursor-2" }, schema, operations, adapter, runtime, page });
    expect(res.ok).toBe(true);
    expect(seen.variables?.after).toBe("cursor-2");
    expect(seen.document).toContain("after: $after");

    const conn = connection() as { nodes: { id: string }[]; pageInfo: { hasNextPage: boolean } };
    expect(conn.nodes.map((n) => n.id)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(conn.pageInfo.hasNextPage).toBe(false);
  });

  it("applies a custom merge (de-dupe by id) over node values read as proxies", async () => {
    const { runtime, connection } = setup();
    // Page overlaps p2 and adds p3.
    const { adapter } = stubAdapter({
      nodes: [
        { __typename: "Product", id: "p2", title: "Two" },
        { __typename: "Product", id: "p3", title: "Three" },
      ],
      pageInfo: { __typename: "PageInfo", hasNextPage: false, endCursor: "cursor-3" },
    });

    const res = await paginateConnection({
      connection: connection(),
      args: { after: "cursor-2" },
      merge: ({ existing, incoming, uniqBy }) => uniqBy([...existing, ...incoming], (n) => (n as { id: string }).id),
      schema,
      operations,
      adapter,
      runtime,
      page,
    });
    expect(res.ok).toBe(true);

    const conn = connection() as { nodes: { id: string }[] };
    // p2 de-duped via the proxy's `.id`: p1, p2, p3 (not p1, p2, p2, p3).
    expect(conn.nodes.map((n) => n.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("surfaces transport errors without mutating the list", async () => {
    const { runtime, connection } = setup();
    const adapter: GraphClientAdapter = { async execute() { return { errors: [{ message: "boom" }] } as never; } };
    const res = await paginateConnection({ connection: connection(), args: { after: "x" }, schema, operations, adapter, runtime, page });
    expect(res).toEqual({ ok: false, error: "boom" });
    expect((connection() as { nodes: unknown[] }).nodes.length).toBe(2);
  });
});
