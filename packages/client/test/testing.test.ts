import { describe, it, expect } from "vitest";
import { defineSchema } from "@gleanql/core";
import { buildTestGraph, createMockAdapter, mockGraphFetch } from "../src/testing.js";
import { GraphRuntime, bindGraph } from "../src/index.js";

const schema = defineSchema({
  queryType: "Query",
  types: [
    {
      name: "Query",
      kind: "object",
      fields: {
        product: { name: "product", type: "Product", args: [{ name: "handle", type: "String!" }] },
        todos: { name: "todos", type: "Todo", list: true },
      },
    },
    {
      name: "Product",
      kind: "object",
      fields: {
        id: { name: "id", type: "ID", nonNull: true },
        title: { name: "title", type: "String" },
        priceRange: { name: "priceRange", type: "ProductPriceRange" },
      },
    },
    {
      name: "ProductPriceRange",
      kind: "object",
      fields: { minVariantPrice: { name: "minVariantPrice", type: "MoneyV2" } },
    },
    {
      name: "MoneyV2",
      kind: "object",
      fields: {
        amount: { name: "amount", type: "String" },
        currencyCode: { name: "currencyCode", type: "String" },
      },
    },
    {
      name: "Todo",
      kind: "object",
      fields: {
        id: { name: "id", type: "ID", nonNull: true },
        title: { name: "title", type: "String" },
        completed: { name: "completed", type: "Boolean" },
      },
    },
  ],
});

const DATA = {
  product: {
    __typename: "Product",
    id: "p1",
    title: "Cool Shirt",
    priceRange: {
      __typename: "ProductPriceRange",
      minVariantPrice: { __typename: "MoneyV2", amount: "39.00", currencyCode: "EUR" },
    },
  },
  todos: [
    { __typename: "Todo", id: "t1", title: "Ship it", completed: false },
    { __typename: "Todo", id: "t2", title: "Test it", completed: true },
  ],
};

describe("buildTestGraph", () => {
  it("seeds plain JSON and reads through real proxies, sync", () => {
    const { glean } = buildTestGraph({ schema, data: DATA });
    const product = glean.product!({ handle: "cool-shirt" }) as any;
    expect(product.title).toBe("Cool Shirt");
    expect(product.priceRange.minVariantPrice.amount).toBe("39.00");
    const todos = glean.todos!() as any[];
    expect(todos.map((t) => t.title)).toEqual(["Ship it", "Test it"]);
  });

  it("a read of an unseeded field rejects with the field name (default onMiss)", async () => {
    const { glean } = buildTestGraph({ schema, data: { product: { __typename: "Product", id: "p1" } } });
    const product = glean.product!({ handle: "x" }) as any;
    let thrown: unknown;
    try {
      void product.title;
    } catch (p) {
      thrown = p;
    }
    expect(thrown).toBeInstanceOf(Promise);
    await expect(thrown as Promise<unknown>).rejects.toThrow(/unseeded field.*title/);
  });

  it("onMiss: 'undefined' resolves misses like the generated client", async () => {
    const { glean, runtime } = buildTestGraph({
      schema,
      data: { product: { __typename: "Product", id: "p1" } },
      onMiss: "undefined",
    });
    const product = glean.product!({ handle: "x" }) as any;
    let suspended: Promise<unknown> | undefined;
    try {
      void product.title;
    } catch (p) {
      suspended = p as Promise<unknown>;
    }
    await suspended;
    expect((glean.product!({ handle: "x" }) as any).title).toBeUndefined();
    expect(runtime).toBeInstanceOf(GraphRuntime);
  });

  it("the payload hydrates a fresh runtime via the production path", () => {
    const { payload } = buildTestGraph({ schema, data: DATA, operationName: "ProductRoute" });
    expect(payload.operationName).toBe("ProductRoute");

    const fresh = GraphRuntime.hydrate(payload.snapshot, {
      fetchMissing: async (misses) => misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: undefined })),
    });
    const graph = bindGraph({ schema, getRuntime: () => fresh, roots: payload.roots });
    expect((graph.product!({ handle: "x" }) as any).title).toBe("Cool Shirt");
  });
});

describe("createMockAdapter", () => {
  const OP = { name: "ProductUpdate", kind: "mutation" as const, document: "mutation ProductUpdate { … }" };

  it("answers from a static handler and records the call", async () => {
    const adapter = createMockAdapter({ ProductUpdate: { productUpdate: { id: "p1", title: "Renamed" } } });
    const result = await adapter.execute(OP, { id: "p1" }, {});
    expect(result.data).toEqual({ productUpdate: { id: "p1", title: "Renamed" } });
    expect(adapter.calls).toEqual([{ name: "ProductUpdate", kind: "mutation", variables: { id: "p1" } }]);
  });

  it("a function handler sees the variables; an errors-shaped return passes through", async () => {
    const adapter = createMockAdapter({
      ProductUpdate: (vars: Record<string, unknown>) => ({ errors: [{ message: `nope: ${vars.id}` }] }),
    });
    const result = await adapter.execute(OP, { id: "p9" }, {});
    expect(result.errors?.[0]?.message).toBe("nope: p9");
  });

  it("an unhandled operation is an error result, not a throw", async () => {
    const adapter = createMockAdapter();
    const result = await adapter.execute(OP, {}, {});
    expect(result.errors?.[0]?.message).toMatch(/no handler for "ProductUpdate"/);
  });

  it("subscriptions are push-driven and end cleanly", async () => {
    const adapter = createMockAdapter();
    const sub = { name: "PriceChanged", kind: "subscription" as const, document: "subscription …" };
    const received: unknown[] = [];

    const consume = (async () => {
      for await (const result of adapter.subscribe!(sub, {}, {})) received.push(result.data);
    })();
    await Promise.resolve(); // let the consumer attach
    adapter.push("PriceChanged", { priceChanged: { amount: "1.00" } });
    adapter.push("PriceChanged", { priceChanged: { amount: "2.00" } });
    adapter.end("PriceChanged");
    await consume;

    expect(received).toEqual([{ priceChanged: { amount: "1.00" } }, { priceChanged: { amount: "2.00" } }]);
    expect(adapter.calls[0]).toEqual({ name: "PriceChanged", kind: "subscription", variables: {} });
  });
});

describe("mockGraphFetch", () => {
  it("intercepts POSTs to the endpoint by operationName and restores", async () => {
    const mock = mockGraphFetch({ ProductRoute: { product: { id: "p1", title: "Hi" } } });
    try {
      const res = await fetch("/graphql", {
        method: "POST",
        body: JSON.stringify({ query: "query ProductRoute { … }", operationName: "ProductRoute", variables: { h: "x" } }),
      });
      expect(await res.json()).toEqual({ data: { product: { id: "p1", title: "Hi" } } });
      expect(mock.calls).toEqual([{ name: "ProductRoute", kind: "query", variables: { h: "x" } }]);
    } finally {
      mock.restore();
    }
  });

  it("answers unknown operations with an error result", async () => {
    const mock = mockGraphFetch({});
    try {
      const res = await fetch("/graphql", { method: "POST", body: JSON.stringify({ operationName: "Nope" }) });
      const body = (await res.json()) as { errors: Array<{ message: string }> };
      expect(body.errors[0]!.message).toMatch(/no handler for "Nope"/);
    } finally {
      mock.restore();
    }
  });
});
