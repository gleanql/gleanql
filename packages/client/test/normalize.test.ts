import { describe, it, expect } from "vitest";
import {
  GraphRuntime,
  type GraphRef,
  runRoute,
  type CompiledOperation,
  type GraphClientAdapter,
} from "../src/index.js";

const RESULT = {
  product: {
    __typename: "Product",
    id: "gid://shopify/Product/1",
    title: "Cool Shirt",
    featuredImage: { __typename: "Image", url: "https://cdn/shirt.png" },
    priceRange: {
      __typename: "ProductPriceRange",
      minVariantPrice: { __typename: "MoneyV2", amount: "29.00", currencyCode: "USD" },
    },
  },
};

function newRuntime() {
  return new GraphRuntime({ fetchMissing: async () => [] });
}

describe("result normalization", () => {
  it("normalizes entities and path objects, and reads back through refs", () => {
    const runtime = newRuntime();
    const roots = runtime.seedResult(RESULT);
    const product = roots.product as GraphRef;
    expect(product).toEqual({ __typename: "Product", id: "gid://shopify/Product/1" });

    expect(runtime.readField(product, "title")).toBe("Cool Shirt");

    // Id-less objects embed under their owning entity, not the query path.
    const image = runtime.readField(product, "featuredImage") as GraphRef;
    expect(image).toEqual({ path: "Product:gid://shopify/Product/1.featuredImage" });
    expect(runtime.readField(image, "url")).toBe("https://cdn/shirt.png");

    const price = runtime.readField(product, "priceRange") as GraphRef;
    expect(price).toEqual({ path: "Product:gid://shopify/Product/1.priceRange" });
    const money = runtime.readField(price, "minVariantPrice") as GraphRef;
    expect(runtime.readField(money, "amount")).toBe("29.00");
  });

  it("dedupes the same entity seen through different results", () => {
    const runtime = newRuntime();
    runtime.seedResult({ product: { __typename: "Product", id: "1", title: "A" } });
    runtime.seedResult({ product: { __typename: "Product", id: "1", handle: "a" } });
    const ref = { __typename: "Product", id: "1" } as GraphRef;
    expect(runtime.readField(ref, "title")).toBe("A");
    expect(runtime.readField(ref, "handle")).toBe("a");
  });

  it("identifies and dedupes entities keyed by a non-id field", () => {
    // A type keyed by `sku` (no id). keyOf is what the integration derives from
    // schema.identityOf; here we supply it directly.
    const keyOf = (typename: string, obj: Record<string, unknown>) =>
      typename === "Variant" && obj.sku != null ? String(obj.sku) : undefined;
    const runtime = new GraphRuntime({ fetchMissing: async () => [], keyOf });

    runtime.seedResult({ a: { __typename: "Variant", sku: "ABC", price: "10" } });
    runtime.seedResult({ b: { __typename: "Variant", sku: "ABC", inStock: true } });
    const ref = { __typename: "Variant", id: "ABC" } as GraphRef; // identity value = sku
    expect(runtime.readField(ref, "price")).toBe("10");
    expect(runtime.readField(ref, "inStock")).toBe(true);
  });

  it("dedupes an id-less child reached through two different queries", () => {
    const runtime = newRuntime();
    // Same Product:1 via two unrelated root fields; its id-less priceRange must
    // resolve to ONE record, so a write through one query is seen by the other.
    runtime.seedResult({
      product: { __typename: "Product", id: "1", priceRange: { __typename: "ProductPriceRange", currencyCode: "USD" } },
    });
    runtime.seedResult({
      featured: { __typename: "Product", id: "1", priceRange: { __typename: "ProductPriceRange", amount: "29.00" } },
    });
    const price = { path: "Product:1.priceRange" } as GraphRef;
    expect(runtime.readField(price, "currencyCode")).toBe("USD"); // from query 1
    expect(runtime.readField(price, "amount")).toBe("29.00"); // merged from query 2
  });
});

describe("runRoute", () => {
  it("computes variables, executes, and seeds the cache", async () => {
    const operation: CompiledOperation<{ params: { handle: string } }> = {
      name: "ProductRoute",
      kind: "query",
      document: "query ProductRoute($handle: String!) { product(handle: $handle) { __typename id title } }",
      variables: (ctx) => ({ handle: ctx.params.handle }),
    };
    let seenVariables: unknown;
    const adapter: GraphClientAdapter = {
      async execute(_op, variables) {
        seenVariables = variables;
        return { data: RESULT } as never;
      },
    };
    const runtime = newRuntime();
    const { roots } = await runRoute({
      operation,
      routeContext: { params: { handle: "cool-shirt" } },
      adapter,
      context: {},
      runtime,
    });
    expect(seenVariables).toEqual({ handle: "cool-shirt" });
    expect(runtime.readField(roots.product as GraphRef, "title")).toBe("Cool Shirt");
  });

  const productSelection = {
    typeName: "Query",
    fields: [
      {
        name: "product",
        args: [["handle", { kind: "var", name: "handle" }]] as const,
        selection: { typeName: "Product", fields: [{ name: "__typename" }, { name: "id" }, { name: "title" }] },
      },
    ],
  };

  function makeOp(selection?: unknown): CompiledOperation<{ params: { handle: string } }> {
    return {
      name: "ProductRoute",
      kind: "query",
      document: "query ProductRoute($handle: String!) { product(handle: $handle) { __typename id title } }",
      variables: (ctx) => ({ handle: ctx.params.handle }),
      selection: selection as never,
    };
  }

  it("cache-first: a covered re-run skips the network", async () => {
    let calls = 0;
    const adapter: GraphClientAdapter = {
      async execute() {
        calls++;
        return { data: RESULT } as never;
      },
    };
    const runtime = newRuntime();
    const common = { operation: makeOp(productSelection), routeContext: { params: { handle: "cool-shirt" } }, adapter, context: {}, runtime };
    await runRoute(common); // miss → fetch + persist links
    const second = await runRoute(common); // covered → no fetch
    expect(calls).toBe(1);
    expect(runtime.readField(second.roots.product as GraphRef, "title")).toBe("Cool Shirt");
  });

  it("cache-first: a selection the cache can't cover re-fetches", async () => {
    let calls = 0;
    const adapter: GraphClientAdapter = {
      async execute() {
        calls++;
        return { data: RESULT } as never; // never includes `handle`
      },
    };
    const runtime = newRuntime();
    const needsHandle = {
      typeName: "Query",
      fields: [
        {
          name: "product",
          args: [["handle", { kind: "var", name: "handle" }]] as const,
          selection: { typeName: "Product", fields: [{ name: "__typename" }, { name: "id" }, { name: "handle" }] },
        },
      ],
    };
    const common = { operation: makeOp(needsHandle), routeContext: { params: { handle: "x" } }, adapter, context: {}, runtime };
    await runRoute(common);
    await runRoute(common); // `handle` absent from cache → not covered → fetch again
    expect(calls).toBe(2);
  });
});

describe("hydration", () => {
  it("round-trips the cache through snapshot/hydrate", () => {
    const server = newRuntime();
    server.seedResult(RESULT);
    const snapshot = server.snapshot();

    const client = GraphRuntime.hydrate(snapshot, { fetchMissing: async () => [] });
    const product = { __typename: "Product", id: "gid://shopify/Product/1" } as GraphRef;
    expect(client.readField(product, "title")).toBe("Cool Shirt");
  });
});
