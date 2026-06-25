import { describe, it, expect, vi } from "vitest";
import { defineSchema, type SchemaModel } from "@gleanql/core";
import {
  GraphScope,
  bindScope,
  type CompiledOperation,
  type GraphClientAdapter,
  type GraphResult,
  type MissingFieldRead,
  type MissingFieldResult,
} from "@gleanql/client";
import {
  buildRouteContext,
  createGraphIntegration,
  serializeGraph,
  renderGraphHydrationScript,
  readGraphHydrationPayload,
  hydrateGraph,
  type GraphRouteContext,
  type RequestInfo,
} from "../src/index.js";

// --- Fixtures: schema, operation, transport ---------------------------------

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
        descriptionHtml: { name: "descriptionHtml", type: "String" },
        featuredImage: { name: "featuredImage", type: "Image" },
        priceRange: { name: "priceRange", type: "ProductPriceRange", nonNull: true },
      },
    },
    { name: "Image", kind: "object", fields: { url: { name: "url", type: "String", nonNull: true }, altText: { name: "altText", type: "String" } } },
    { name: "ProductPriceRange", kind: "object", fields: { minVariantPrice: { name: "minVariantPrice", type: "MoneyV2", nonNull: true } } },
    { name: "MoneyV2", kind: "object", fields: { amount: { name: "amount", type: "String", nonNull: true }, currencyCode: { name: "currencyCode", type: "String", nonNull: true } } },
    { name: "String", kind: "scalar" },
    { name: "ID", kind: "scalar" },
  ],
});

const ProductRouteOperation: CompiledOperation<GraphRouteContext> = {
  name: "ProductRoute",
  kind: "query",
  document: "query ProductRoute($handle: String!) { product(handle: $handle) { __typename id title featuredImage { __typename url } priceRange { __typename minVariantPrice { __typename amount currencyCode } } } }",
  hash: "deadbeef",
  variables: (ctx) => ({ handle: ctx.params.handle }),
  readMap: { ProductHero: ["Product.title", "Product.featuredImage.url"] },
};

const ProductUpdateOperation: CompiledOperation<GraphRouteContext> = {
  name: "ProductUpdate",
  kind: "mutation",
  document: "mutation ProductUpdate($id: ID!, $title: String!) { productUpdate(id: $id, title: $title) { product { __typename id title } userErrors { field message } } }",
  hash: "feedface",
  variables: (ctx) => ({ id: ctx.params.id, title: ctx.params.title }),
  readMap: {},
};

const operations = { ProductRoute: ProductRouteOperation, ProductUpdate: ProductUpdateOperation };

/** A product result keyed by handle, as a real GraphQL endpoint would return. */
function productResult(handle: string, title: string) {
  return {
    product: {
      __typename: "Product",
      id: `gid://shopify/Product/${handle}`,
      title,
      featuredImage: { __typename: "Image", url: `https://cdn/${handle}.png`, altText: null },
      priceRange: {
        __typename: "ProductPriceRange",
        minVariantPrice: { __typename: "MoneyV2", amount: "29.00", currencyCode: "USD" },
      },
    },
  };
}

function makeAdapter(resultFor: (variables: { handle: string }) => Record<string, unknown>): {
  adapter: GraphClientAdapter;
  execute: ReturnType<typeof vi.fn>;
} {
  const execute = vi.fn(async (_op, variables): Promise<GraphResult<unknown>> => ({
    data: resultFor(variables as { handle: string }),
  }));
  return { adapter: { execute } as GraphClientAdapter, execute };
}

/** A RedwoodSDK-shaped RequestInfo. */
function makeRequest(url: string, params: Record<string, string>): RequestInfo {
  return { request: new Request(url), params, ctx: {} };
}

// --- Tests ------------------------------------------------------------------

describe("buildRouteContext", () => {
  it("extracts params and search from the RequestInfo", () => {
    const ri = makeRequest("https://shop.test/product/cool-shirt?preview=true&tag=a&tag=b", { handle: "cool-shirt" });
    const ctx = buildRouteContext(ri, { context: () => ({ locale: "en-US", accessToken: "secret" }) });
    expect(ctx.params.handle).toBe("cool-shirt");
    expect(ctx.search.get("preview")).toBe("true");
    expect(ctx.search.getAll("tag")).toEqual(["a", "b"]);
    expect(ctx.locale).toBe("en-US");
  });
});

describe("integration.preload: server render", () => {
  it("executes the operation, seeds the cache, and reads fields synchronously through the bound graph", async () => {
    const { adapter, execute } = makeAdapter((v) => productResult(v.handle, "Cool Shirt"));
    const integration = createGraphIntegration({ schema, operations, adapter });
    const ri = makeRequest("https://shop.test/product/cool-shirt", { handle: "cool-shirt" });

    const active = await integration.preload(ri, "ProductRoute");
    expect(active).toBeDefined();
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: "ProductRoute" }), { handle: "cool-shirt" }, expect.anything());

    // Simulate the Page/components rendering and reading graph fields.
    const graph = integration.getGraph(ri);
    const product = graph.product!({ handle: "cool-shirt" }) as any;
    expect(product.title).toBe("Cool Shirt");
    expect(product.featuredImage?.url).toBe("https://cdn/cool-shirt.png");
    expect(product.priceRange.minVariantPrice.amount).toBe("29.00");
    expect(product.priceRange.minVariantPrice.currencyCode).toBe("USD");
  });

  it("returns undefined for a non-graph entrypoint (unknown operation)", async () => {
    const { adapter } = makeAdapter((v) => productResult(v.handle, "X"));
    const integration = createGraphIntegration({ schema, operations, adapter });
    const ri = makeRequest("https://shop.test/about", {});
    expect(await integration.preload(ri, "NoSuchOperation")).toBeUndefined();
  });

  it("isolates concurrent requests in separate caches", async () => {
    const { adapter } = makeAdapter((v) => productResult(v.handle, v.handle === "a" ? "Product A" : "Product B"));
    const integration = createGraphIntegration({ schema, operations, adapter });
    const ra = makeRequest("https://shop.test/product/a", { handle: "a" });
    const rb = makeRequest("https://shop.test/product/b", { handle: "b" });

    const [aa, bb] = await Promise.all([integration.preload(ra, "ProductRoute"), integration.preload(rb, "ProductRoute")]);
    expect((integration.getGraph(ra).product!({ handle: "a" }) as any).title).toBe("Product A");
    expect((integration.getGraph(rb).product!({ handle: "b" }) as any).title).toBe("Product B");
    expect(aa!.runtime).not.toBe(bb!.runtime);
  });

  it("fetches a lazy field absent from the compiled operation through fetchMissing", async () => {
    const { adapter } = makeAdapter((v) => productResult(v.handle, "Cool Shirt"));
    const fetchMissing = vi.fn(
      async (misses: readonly MissingFieldRead[]): Promise<MissingFieldResult[]> =>
        misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: "<p>Lazy</p>" })),
    );
    const integration = createGraphIntegration({ schema, operations, adapter, fetchMissing });
    const ri = makeRequest("https://shop.test/product/cool-shirt", { handle: "cool-shirt" });
    await integration.preload(ri, "ProductRoute");
    const product = integration.getGraph(ri).product!({ handle: "cool-shirt" }) as any;

    let thrown: unknown;
    try {
      void product.descriptionHtml;
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Promise);
    // The integration's default scheduler is queueMicrotask; await the promise.
    await thrown;
    expect(product.descriptionHtml).toBe("<p>Lazy</p>");
    expect(fetchMissing).toHaveBeenCalledTimes(1);
  });
});

describe("integration mutations", () => {
  /** An adapter that answers both the query (preload) and the mutation. */
  function dualAdapter() {
    const execute = vi.fn(async (op: { name: string }, variables): Promise<GraphResult<unknown>> => {
      if (op.name === "ProductUpdate") {
        const v = variables as { id: string; title: string };
        return { data: { productUpdate: { product: { __typename: "Product", id: v.id, title: v.title }, userErrors: [] } } };
      }
      return { data: productResult((variables as { handle: string }).handle, "Cool Shirt") };
    });
    return { adapter: { execute } as GraphClientAdapter, execute };
  }

  it("runs graph.mutate.* and the change is visible through the already-rendered graph", async () => {
    const { adapter } = dualAdapter();
    const integration = createGraphIntegration({ schema, operations, adapter });
    const ri = makeRequest("https://shop.test/product/cool-shirt", { handle: "cool-shirt" });
    await integration.preload(ri, "ProductRoute");

    const product = integration.getGraph(ri).product!({ handle: "cool-shirt" }) as any;
    expect(product.title).toBe("Cool Shirt");

    const mutate = integration.getMutator(ri);
    const result = await mutate.ProductUpdate!({ id: "gid://shopify/Product/cool-shirt", title: "Renamed" });
    expect(result.ok).toBe(true);
    // Same normalized entity — the existing proxy reflects the mutation.
    expect(product.title).toBe("Renamed");
  });

  it("supports optimistic writes through the request runtime and invalidate()", async () => {
    const { adapter } = dualAdapter();
    const integration = createGraphIntegration({ schema, operations, adapter });
    const ri = makeRequest("https://shop.test/product/cool-shirt", { handle: "cool-shirt" });
    const active = await integration.preload(ri, "ProductRoute");
    const productRef = active!.roots.product;

    const seen: string[] = [];
    await integration.getMutator(ri).ProductUpdate!(
      { id: "gid://shopify/Product/cool-shirt", title: "Server" },
      {
        optimistic: (tx) => {
          tx.set(productRef as any, "title", "Optimistic");
          seen.push(active!.runtime.readField(productRef as any, "title") as string);
        },
      },
    );
    expect(seen).toEqual(["Optimistic"]);
    expect((integration.getGraph(ri).product!({ handle: "cool-shirt" }) as any).title).toBe("Server");

    // invalidate() drops the record so the next read refetches.
    integration.invalidate(ri, productRef);
    expect(active!.runtime.cache.hasRecord(productRef as any)).toBe(false);
  });

  // The server `mutate()` primitive: a compiled mutation, executed server-side
  // with NO preloaded read graph (server actions / webhooks / jobs).
  const fulfill: CompiledOperation<GraphRouteContext> = {
    name: "Book_fulfillmentCreate",
    kind: "mutation",
    document:
      "mutation Book_fulfillmentCreate($id: ID!) { fulfillmentCreate(id: $id) { fulfillment { __typename id } userErrors { field message } } }",
    hash: "f1",
    // selector-style: maps the call's vars directly (not a route context)
    variables: (vars: any) => ({ id: vars.id }),
    readMap: {},
  };

  it("integration.mutate runs a compiled mutation standalone (no preload) and returns the result", async () => {
    const execute = vi.fn(async (): Promise<GraphResult<unknown>> => ({
      data: { fulfillmentCreate: { fulfillment: { __typename: "Fulfillment", id: "f/1" }, userErrors: [] } },
    }));
    const integration = createGraphIntegration({
      schema,
      operations: { ...operations, Book_fulfillmentCreate: fulfill },
      adapter: { execute } as GraphClientAdapter,
    });
    const result = await integration.mutate("Book_fulfillmentCreate", { id: "gid://shopify/Order/1" });
    expect(execute).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Book_fulfillmentCreate", kind: "mutation" }),
      { id: "gid://shopify/Order/1" },
      expect.anything(),
    );
    expect(result.ok).toBe(true);
    expect((result.data as any).fulfillmentCreate.fulfillment.id).toBe("f/1");
  });

  it("integration.mutate surfaces userErrors as ok:false", async () => {
    const execute = vi.fn(async (): Promise<GraphResult<unknown>> => ({
      data: { fulfillmentCreate: { fulfillment: null, userErrors: [{ field: ["id"], message: "no such order" }] } },
    }));
    const integration = createGraphIntegration({
      schema,
      operations: { ...operations, Book_fulfillmentCreate: fulfill },
      adapter: { execute } as GraphClientAdapter,
    });
    const result = await integration.mutate("Book_fulfillmentCreate", { id: "x" });
    expect(result.ok).toBe(false);
    expect(result.userErrors[0]!.message).toBe("no such order");
  });

  it("integration.mutate returns an error for an unknown / non-mutation operation", async () => {
    const { adapter } = dualAdapter();
    const integration = createGraphIntegration({ schema, operations, adapter });
    expect((await integration.mutate("NoSuch", {})).errors?.[0]?.message).toContain("unknown mutation operation");
    // ProductRoute is a query, not a mutation
    expect((await integration.mutate("ProductRoute", {})).ok).toBe(false);
  });
});

describe("runInScope", () => {
  it("installs the request runtime on a scope so a module-level graph import resolves", async () => {
    const { adapter } = makeAdapter((v) => productResult(v.handle, "Scoped"));
    const scope = new GraphScope();
    const integration = createGraphIntegration({ schema, operations, adapter, scope });
    const ri = makeRequest("https://shop.test/product/x", { handle: "x" });
    await integration.preload(ri, "ProductRoute");

    const title = integration.runInScope(ri, () => {
      // Stand-in for `import { graph } from "~/graph"` resolving via the scope.
      const graph = scope.current().graph;
      return (graph.product!({ handle: "x" }) as any).title;
    });
    expect(title).toBe("Scoped");
    expect(() => scope.current()).toThrow(); // scope released after render
  });

  it("bindScope pairs a scope with the resolver the generated accessor calls", async () => {
    const { adapter } = makeAdapter((v) => productResult(v.handle, "Bound"));
    // What an app exports for `requestScope: { import: "activeGraph", from: ... }`.
    const { scope, activeGraph } = bindScope();
    const integration = createGraphIntegration({ schema, operations, adapter, scope });
    const ri = makeRequest("https://shop.test/product/x", { handle: "x" });
    await integration.preload(ri, "ProductRoute");

    const title = integration.runInScope(ri, () => {
      // Stand-in for the generated `__active()` → `activeGraph()`.
      const graph = activeGraph().graph;
      return (graph.product!({ handle: "x" }) as any).title;
    });
    expect(title).toBe("Bound");
    expect(() => activeGraph()).toThrow(); // resolver throws outside any scope
  });
});

describe("serialize / hydrate across the boundary", () => {
  it("serializes only client-safe context and round-trips through the hydration script", async () => {
    const { adapter } = makeAdapter((v) => productResult(v.handle, "Cool Shirt"));
    const integration = createGraphIntegration({
      schema,
      operations,
      adapter,
      context: () => ({ locale: "en-US", accessToken: "SECRET-TOKEN" }),
    });
    const ri = makeRequest("https://shop.test/product/cool-shirt", { handle: "cool-shirt" });
    const active = await integration.preload(ri, "ProductRoute");

    const payload = serializeGraph(active!, { clientSafeContext: ["locale"] });
    expect(payload.context).toEqual({ locale: "en-US" });
    expect(JSON.stringify(payload)).not.toContain("SECRET-TOKEN"); // secrets stay server-side

    const script = renderGraphHydrationScript(payload, { globalKey: "__G__" });
    // The JSON payload (everything but the wrapping <script>…</script>) must not
    // contain a tag breakout: only the single trailing </script> may appear.
    expect((script.match(/<\/script>/g) ?? []).length).toBe(1);
    const body = script.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, "");
    expect(body).not.toContain("<");

    // Simulate the browser: eval the script, then read + hydrate.
    const win = globalThis as Record<string, unknown>;
    new Function("window", script.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""))(win);
    const recovered = readGraphHydrationPayload("__G__");
    expect(recovered).toBeDefined();
    delete win["__G__"];

    const client = hydrateGraph(recovered!, { schema, adapter });
    const product = client.graph.product!({ handle: "cool-shirt" }) as any;
    expect(product.title).toBe("Cool Shirt"); // cache hit, no refetch
    expect(product.featuredImage?.url).toBe("https://cdn/cool-shirt.png");
  });

  it("escapes hostile string values so they cannot break out of the script tag", () => {
    const payload = {
      operationName: "X",
      variables: {},
      snapshot: { "path:p": { note: "</script><script>alert(1)</script> &   " } },
      roots: {},
      context: {},
    };
    const script = renderGraphHydrationScript(payload as any);
    expect((script.match(/<\/script>/g) ?? []).length).toBe(1); // only the real closer
    expect(script).toContain("\\u003c/script\\u003e");
    expect(script).toContain("\\u0026"); // & escaped
    expect(script).toContain("\\u2028");
    // And it still parses back to the original value.
    const win = globalThis as Record<string, unknown>;
    new Function("window", script.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""))(win);
    expect((readGraphHydrationPayload()!.snapshot["path:p"] as any).note).toContain("</script>");
    delete win["__GRAPH_STATE__"];
  });

  it("client reads of fields absent from the snapshot fetch through the client adapter", async () => {
    const { adapter } = makeAdapter((v) => productResult(v.handle, "Cool Shirt"));
    const integration = createGraphIntegration({ schema, operations, adapter });
    const ri = makeRequest("https://shop.test/product/cool-shirt", { handle: "cool-shirt" });
    const active = await integration.preload(ri, "ProductRoute");
    const payload = serializeGraph(active!, { clientSafeContext: [] });

    const fetchMissing = vi.fn(
      async (misses: readonly MissingFieldRead[]): Promise<MissingFieldResult[]> =>
        misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: "<p>Client lazy</p>" })),
    );
    const client = hydrateGraph(payload, { schema, adapter, fetchMissing });
    const product = client.graph.product!({ handle: "cool-shirt" }) as any;

    let thrown: unknown;
    try {
      void product.descriptionHtml;
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Promise);
    await thrown;
    expect(product.descriptionHtml).toBe("<p>Client lazy</p>");
    expect(fetchMissing).toHaveBeenCalledTimes(1);
  });
});
