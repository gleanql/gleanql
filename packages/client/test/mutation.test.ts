import { describe, it, expect, vi } from "vitest";
import {
  GraphRuntime,
  runMutation,
  invalidateValue,
  createMutator,
  MutationTransaction,
  GraphCache,
  type GraphClientAdapter,
  type GraphRef,
  type GraphResult,
  type MissingFieldRead,
  type MissingFieldResult,
} from "../src/index.js";

const PRODUCT: GraphRef = { __typename: "Product", id: "gid://shopify/Product/1" };

function makeRuntime(missing: Record<string, unknown> = {}) {
  const scheduled: Array<() => void> = [];
  const fetchMissing = vi.fn(
    async (misses: readonly MissingFieldRead[]): Promise<MissingFieldResult[]> =>
      misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: missing[m.fieldKey] })),
  );
  const runtime = new GraphRuntime({ fetchMissing, schedule: (cb) => scheduled.push(cb) });
  const flush = async () => {
    while (scheduled.length) scheduled.shift()!();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { runtime, flush };
}

function adapterReturning(data: unknown, errors?: { message: string }[]): GraphClientAdapter {
  return { execute: async (): Promise<GraphResult<unknown>> => ({ data, ...(errors ? { errors } : {}) }) } as GraphClientAdapter;
}

const ctx = {} as Record<string, unknown>;
const op = { name: "ProductUpdate", kind: "mutation" as const, document: "mutation ProductUpdate { ... }" };

describe("runMutation: cache application", () => {
  it("normalizes the result so the updated entity is visible through existing reads", async () => {
    const { runtime } = makeRuntime();
    runtime.seed(PRODUCT, { title: "Old Title" });
    expect(runtime.readField(PRODUCT, "title")).toBe("Old Title");

    const result = await runMutation({
      operation: op,
      variables: { id: PRODUCT.id, title: "New Title" },
      adapter: adapterReturning({
        productUpdate: {
          product: { __typename: "Product", id: PRODUCT.id, title: "New Title" },
          userErrors: [],
        },
      }),
      context: ctx,
      runtime,
    });

    expect(result.ok).toBe(true);
    expect(result.userErrors).toEqual([]);
    // Same entity, updated in place — the original read now reflects the change.
    expect(runtime.readField(PRODUCT, "title")).toBe("New Title");
  });
});

describe("runMutation: userErrors", () => {
  it("surfaces userErrors and reports ok=false without throwing", async () => {
    const { runtime } = makeRuntime();
    runtime.seed(PRODUCT, { title: "Old Title" });

    const result = await runMutation({
      operation: op,
      variables: {},
      adapter: adapterReturning({
        productUpdate: {
          product: null,
          userErrors: [{ field: ["title"], message: "Title is required", code: "BLANK" }],
        },
      }),
      context: ctx,
      runtime,
    });

    expect(result.ok).toBe(false);
    expect(result.userErrors).toEqual([{ field: ["title"], message: "Title is required", code: "BLANK" }]);
    expect(runtime.readField(PRODUCT, "title")).toBe("Old Title"); // unchanged
  });
});

describe("runMutation: optimistic updates", () => {
  it("applies an optimistic write, then commits the server result on success", async () => {
    const { runtime } = makeRuntime();
    runtime.seed(PRODUCT, { title: "Old Title" });
    let seenDuringRequest: unknown;

    const adapter: GraphClientAdapter = {
      execute: async () => {
        seenDuringRequest = runtime.readField(PRODUCT, "title"); // optimistic value in flight
        return { data: { productUpdate: { product: { __typename: "Product", id: PRODUCT.id, title: "Server Title" }, userErrors: [] } } };
      },
    } as GraphClientAdapter;

    const result = await runMutation({
      operation: op,
      variables: {},
      adapter,
      context: ctx,
      runtime,
      optimistic: (tx) => tx.set(PRODUCT, "title", "Optimistic Title"),
    });

    expect(seenDuringRequest).toBe("Optimistic Title");
    expect(result.ok).toBe(true);
    expect(runtime.readField(PRODUCT, "title")).toBe("Server Title"); // server wins
  });

  it("rolls back the optimistic write on a transport error", async () => {
    const { runtime } = makeRuntime();
    runtime.seed(PRODUCT, { title: "Old Title" });

    const result = await runMutation({
      operation: op,
      variables: {},
      adapter: { execute: async () => { throw new Error("network down"); } } as GraphClientAdapter,
      context: ctx,
      runtime,
      optimistic: (tx) => tx.set(PRODUCT, "title", "Optimistic Title"),
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ message: "network down" }]);
    expect(runtime.readField(PRODUCT, "title")).toBe("Old Title"); // rolled back
  });

  it("rolls back the optimistic write when the server returns userErrors", async () => {
    const { runtime } = makeRuntime();
    runtime.seed(PRODUCT, { title: "Old Title" });

    await runMutation({
      operation: op,
      variables: {},
      adapter: adapterReturning({ productUpdate: { product: null, userErrors: [{ message: "nope" }] } }),
      context: ctx,
      runtime,
      optimistic: (tx) => tx.set(PRODUCT, "title", "Optimistic Title"),
    });

    expect(runtime.readField(PRODUCT, "title")).toBe("Old Title"); // rolled back
  });
});

describe("invalidation", () => {
  it("invalidate() forces a refetch on the next read", async () => {
    const { runtime, flush } = makeRuntime({ title: "Refetched" });
    runtime.seed(PRODUCT, { title: "Old Title" });

    const result = await runMutation({
      operation: op,
      variables: {},
      adapter: adapterReturning({ productUpdate: { product: { __typename: "Product", id: PRODUCT.id }, userErrors: [] } }),
      context: ctx,
      runtime,
      invalidate: () => [PRODUCT],
    });
    expect(result.ok).toBe(true);

    let thrown: unknown;
    try {
      runtime.readField(PRODUCT, "title");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Promise);
    await flush();
    expect(runtime.readField(PRODUCT, "title")).toBe("Refetched");
  });

  it("invalidateValue() accepts a raw ref", () => {
    const { runtime } = makeRuntime();
    runtime.seed(PRODUCT, { title: "x" });
    expect(runtime.cache.hasRecord(PRODUCT)).toBe(true);
    invalidateValue(runtime, PRODUCT);
    expect(runtime.cache.hasRecord(PRODUCT)).toBe(false);
  });
});

describe("MutationTransaction", () => {
  it("restores prior values and removes fields that were absent", () => {
    const cache = new GraphCache();
    cache.setField(PRODUCT, "title", "Original");
    const tx = new MutationTransaction(cache);
    tx.set(PRODUCT, "title", "Changed");
    tx.set(PRODUCT, "subtitle", "Added"); // was absent
    expect(cache.getField(PRODUCT, "title")).toEqual({ status: "ready", value: "Changed" });

    tx.rollback();
    expect(cache.getField(PRODUCT, "title")).toEqual({ status: "ready", value: "Original" });
    expect(cache.getField(PRODUCT, "subtitle")).toEqual({ status: "missing" });
  });
});

describe("createMutator", () => {
  it("binds one callable per compiled mutation operation, ignoring queries", async () => {
    const { runtime } = makeRuntime();
    runtime.seed(PRODUCT, { title: "Old Title" });
    const operations = {
      ProductUpdate: { name: "ProductUpdate", kind: "mutation" as const, document: "mutation {}", hash: "h", variables: () => ({}), readMap: {} },
      ProductRoute: { name: "ProductRoute", kind: "query" as const, document: "query {}", hash: "h", variables: () => ({}), readMap: {} },
    };
    const mutate = createMutator({
      operations,
      adapter: adapterReturning({ productUpdate: { product: { __typename: "Product", id: PRODUCT.id, title: "Mutated" }, userErrors: [] } }),
      runtime,
      context: ctx,
    });

    expect(Object.keys(mutate)).toEqual(["ProductUpdate"]); // query not bound
    const result = await mutate.ProductUpdate!({ id: PRODUCT.id, title: "Mutated" });
    expect(result.ok).toBe(true);
    expect(runtime.readField(PRODUCT, "title")).toBe("Mutated");
  });
});
