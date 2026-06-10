import { describe, it, expect, vi } from "vitest";
import {
  GraphRuntime,
  type GraphClientAdapter,
  type GraphRef,
  type GraphResult,
  type CompiledOperation,
} from "../src/index.js";
import { runBoundMutation } from "../src/glue-client.js";

const PRODUCT: GraphRef = { __typename: "Product", id: "gid://shopify/Product/1" };

function makeRuntime() {
  const runtime = new GraphRuntime({
    fetchMissing: async (misses) => misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: undefined })),
  });
  return runtime;
}

function adapterReturning(data: unknown, errors?: { message: string }[]): GraphClientAdapter {
  return { execute: async (): Promise<GraphResult<unknown>> => ({ data, ...(errors ? { errors } : {}) }) } as GraphClientAdapter;
}

/** A compiled mutation op whose variables factory maps the `mutate(vars)` arg through. */
function mutationOp(): Record<string, CompiledOperation> {
  return {
    EditTitle_setProductTitle: {
      name: "EditTitle_setProductTitle",
      kind: "mutation",
      document: "mutation EditTitle_setProductTitle($id: ID!, $title: String!) { setProductTitle(id: $id, title: $title) { __typename id title } }",
      hash: "h",
      variables: (ctx: unknown) => ctx as Record<string, unknown>,
      readMap: {},
    } as unknown as CompiledOperation,
  };
}

describe("runBoundMutation", () => {
  it("maps vars via the op factory, runs the mutation, and normalizes the result in place", async () => {
    const runtime = makeRuntime();
    runtime.seed(PRODUCT, { title: "Old Title" });
    expect(runtime.readField(PRODUCT, "title")).toBe("Old Title");

    const execute = vi.fn(async () => ({
      data: { setProductTitle: { __typename: "Product", id: PRODUCT.id, title: "New Title" } },
    }));

    const result = await runBoundMutation({
      opName: "EditTitle_setProductTitle",
      vars: { id: PRODUCT.id, title: "New Title" },
      operations: mutationOp(),
      adapter: { execute } as unknown as GraphClientAdapter,
      runtime,
      context: {},
    });

    expect(result.ok).toBe(true);
    // The op factory passed the user's vars straight through as GraphQL variables.
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: "EditTitle_setProductTitle", kind: "mutation" }),
      { id: PRODUCT.id, title: "New Title" },
      {},
    );
    // Same entity, updated in place — the original read reflects the change.
    expect(runtime.readField(PRODUCT, "title")).toBe("New Title");
  });

  it("rolls back the optimistic write when the server returns userErrors", async () => {
    const runtime = makeRuntime();
    runtime.seed(PRODUCT, { title: "Old Title" });

    const result = await runBoundMutation({
      opName: "EditTitle_setProductTitle",
      vars: { id: PRODUCT.id, title: "" },
      options: { optimistic: (tx) => tx.set(PRODUCT, "title", "Optimistic") },
      operations: mutationOp(),
      adapter: adapterReturning({ setProductTitle: { __typename: "Product", id: PRODUCT.id, userErrors: [{ message: "blank" }] } }),
      runtime,
      context: {},
    });

    expect(result.ok).toBe(false);
    expect(result.userErrors).toEqual([{ message: "blank" }]);
    expect(runtime.readField(PRODUCT, "title")).toBe("Old Title"); // rolled back
  });

  it("rolls back on a transport error", async () => {
    const runtime = makeRuntime();
    runtime.seed(PRODUCT, { title: "Old Title" });

    const result = await runBoundMutation({
      opName: "EditTitle_setProductTitle",
      vars: { id: PRODUCT.id, title: "x" },
      options: { optimistic: (tx) => tx.set(PRODUCT, "title", "Optimistic") },
      operations: mutationOp(),
      adapter: { execute: async () => { throw new Error("network down"); } } as GraphClientAdapter,
      runtime,
      context: {},
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual([{ message: "network down" }]);
    expect(runtime.readField(PRODUCT, "title")).toBe("Old Title");
  });

  it("reports a clear error for an unknown / non-mutation operation name", async () => {
    const runtime = makeRuntime();
    const result = await runBoundMutation({
      opName: "Nope",
      vars: {},
      operations: mutationOp(),
      adapter: adapterReturning({}),
      runtime,
      context: {},
    });
    expect(result.ok).toBe(false);
    expect(result.errors?.[0]?.message).toContain("unknown mutation operation");
  });
});
