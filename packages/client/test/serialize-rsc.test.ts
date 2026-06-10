import { describe, it, expect, vi } from "vitest";
import { defineSchema, type SchemaModel } from "@gleanql/core";
import {
  GraphRuntime,
  bindGraph,
  absorbHydrationPayload,
  pagePointer,
  refetch,
  type CompiledOperation,
  type GraphClientAdapter,
  type GraphHydrationPayload,
  type GraphPagePointer,
} from "../src/index.js";

// Minimal storefront: a product with a mutable `views` counter.
const schema: SchemaModel = defineSchema({
  queryType: "Query",
  types: [
    { name: "Query", kind: "object", fields: { product: { name: "product", type: "Product", args: [{ name: "handle", type: "String!" }] } } },
    {
      name: "Product",
      kind: "object",
      fields: {
        id: { name: "id", type: "ID", nonNull: true },
        title: { name: "title", type: "String", nonNull: true },
        views: { name: "views", type: "Int", nonNull: true },
      },
    },
    { name: "String", kind: "scalar" },
    { name: "ID", kind: "scalar" },
    { name: "Int", kind: "scalar" },
  ],
});

/** A hydration payload as the server would serialize it for one product route. */
function payloadFor(handle: string, views: number): GraphHydrationPayload {
  const id = `gid://Product/${handle}`;
  return {
    operationName: "ProductPage",
    variables: { handle },
    context: {},
    snapshot: { [`Product:${id}`]: { __typename: "Product", id, title: handle, views } },
    roots: { product: { __typename: "Product", id } },
  };
}

const ProductPageOperation: CompiledOperation<{ params: { handle: string } }> = {
  name: "ProductPage",
  kind: "query",
  document: "query ProductPage($handle: String!) { product(handle: $handle) { __typename id views } }",
  hash: "rsc",
  variables: (ctx) => ({ handle: ctx.params.handle }),
};

/**
 * Mirror the generated client glue: one long-lived runtime, a bound graph whose
 * roots follow the page-current pointer, and a per-nav merge.
 */
function makeClient() {
  const runtime = new GraphRuntime({
    keyOf: (typename, obj) => schema.identityOf(typename, obj),
    fetchMissing: async (misses) => misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: undefined })),
  });
  let currentPage: GraphPagePointer | undefined;
  const graph = bindGraph({ schema, getRuntime: () => runtime, roots: () => currentPage?.roots });
  /** What GraphHydrator does per navigation: absorb (write) + update pointer + notify. */
  const navigate = (payload: GraphHydrationPayload): boolean => {
    const changed = absorbHydrationPayload(runtime, payload);
    currentPage = pagePointer(payload);
    if (changed) runtime.notify();
    return changed;
  };
  return { runtime, graph, navigate, page: () => currentPage! };
}

describe("RSC hydration: per-navigation merge", () => {
  it("makes the navigated-to page warm and accumulates prior entities in the cache", () => {
    const { runtime, graph, navigate } = makeClient();

    navigate(payloadFor("a", 1));
    expect((graph.product!({ handle: "a" }) as any).views).toBe(1); // page a warm

    navigate(payloadFor("b", 2));
    // The root accessor is page-current (roots are keyed by field, updated per nav):
    // an island on page b reads the new product warm, with no wire fetch.
    expect((graph.product!({ handle: "b" }) as any).views).toBe(2);
    // ...and product a's record is STILL in the cache — it accumulates across
    // navigations (the one-shot window global was replaced wholesale each load).
    expect(runtime.cache.getField({ __typename: "Product", id: "gid://Product/a" }, "views")).toEqual({
      status: "ready",
      value: 1,
    });
  });

  it("re-absorbing the same payload is a no-op (idempotent)", () => {
    const { navigate } = makeClient();
    expect(navigate(payloadFor("a", 1))).toBe(true);
    expect(navigate(payloadFor("a", 1))).toBe(false);
  });

  it("refresh() follows the current page's variables, not the page loaded first", async () => {
    const { runtime, navigate, page } = makeClient();
    navigate(payloadFor("a", 1));
    navigate(payloadFor("b", 2)); // navigated to product b

    expect(page().variables).toEqual({ handle: "b" });

    const execute = vi.fn(async (_op: unknown, _variables: Record<string, unknown>) => ({
      data: { product: { __typename: "Product", id: "gid://Product/b", views: 99 } },
    }));
    const adapter: GraphClientAdapter = { execute } as unknown as GraphClientAdapter;

    // refresh() reads currentPage.variables — must refetch b, not the initial a.
    await refetch({
      operation: ProductPageOperation,
      routeContext: { params: page().variables as { handle: string } },
      adapter,
      context: page().context,
      runtime,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![1]).toEqual({ handle: "b" }); // the fix: not pinned to "a"
  });
});
