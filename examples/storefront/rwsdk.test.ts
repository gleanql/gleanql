import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeWithTs } from "@gleanql/compiler";
import type { CompiledOperation, GraphClientAdapter, GraphResult } from "@gleanql/client";
import {
  createGraphIntegration,
  serializeGraph,
  renderGraphHydrationScript,
  readGraphHydrationPayload,
  hydrateGraph,
  type GraphRouteContext,
  type RequestInfo,
} from "@gleanql/client";
import { storefrontSchema } from "./graph/schema-model.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Full vertical slice: the *real* compiler output for ProductRoute.tsx driven
 * through the RWSDK adapter — request -> preload -> server reads via bound graph
 * proxies -> serialize -> hydrate -> client reads. No hand-written operation.
 */
describe("storefront × @gleanql/rwsdk (end-to-end)", () => {
  // 1. Compile the route exactly as the build would.
  const compiled = analyzeWithTs({
    fileName: path.join(here, "routes/ProductRoute.tsx"),
    supportDir: path.join(here, "graph"),
    schema: storefrontSchema,
  });
  const artifact = compiled.operations[0]!;

  // 2. Turn the artifact into a runnable CompiledOperation (eval the factory).
  const operation = toCompiledOperation(artifact);
  const operations = { [operation.name]: operation };

  // 3. A transport that answers the compiled ProductRoute query.
  function makeAdapter() {
    const execute = vi.fn(async (_op, variables): Promise<GraphResult<unknown>> => {
      const handle = (variables as { handle: string }).handle;
      return {
        data: {
          product: {
            __typename: "Product",
            id: `gid://shopify/Product/${handle}`,
            title: "Cool Shirt",
            featuredImage: { __typename: "Image", url: `https://cdn/${handle}.png`, altText: null },
            priceRange: {
              __typename: "ProductPriceRange",
              minVariantPrice: { __typename: "MoneyV2", amount: "29.00", currencyCode: "USD" },
            },
          },
        },
      };
    });
    return { adapter: { execute } as GraphClientAdapter, execute };
  }

  const request = (): RequestInfo => ({
    request: new Request("https://shop.test/product/cool-shirt"),
    params: { handle: "cool-shirt" },
    ctx: {},
  });

  it("compiles, preloads, and reads every field the components read", async () => {
    const { adapter, execute } = makeAdapter();
    const integration = createGraphIntegration({ schema: storefrontSchema, operations, adapter });

    const ri = request();
    const active = await integration.preload(ri, operation.name);
    expect(active).toBeDefined();
    // Variables came from the *generated* factory reading ctx.params.handle.
    expect(execute).toHaveBeenCalledWith(expect.objectContaining({ name: "ProductRoute" }), { handle: "cool-shirt" }, expect.anything());

    // The components read these paths (from the compiled read map). Reading the
    // same paths through the bound graph hits the seeded cache — no suspend.
    const graph = integration.getGraph(ri);
    const product = graph.product!({ handle: "cool-shirt" }) as any;
    expect(product.title).toBe("Cool Shirt"); // ProductHero
    expect(product.featuredImage?.url).toBe("https://cdn/cool-shirt.png"); // ProductHero
    const price = product.priceRange.minVariantPrice; // BuyBox
    expect(price.amount).toBe("29.00");
    expect(price.currencyCode).toBe("USD");

    expect(Object.keys(compiled.readMap)).toEqual(["ProductHero", "BuyBox"]);
  });

  it("serializes the cache and rehydrates on the client with warm reads", async () => {
    const { adapter } = makeAdapter();
    const integration = createGraphIntegration({ schema: storefrontSchema, operations, adapter });
    const ri = request();
    const active = await integration.preload(ri, operation.name);

    const payload = serializeGraph(active!, { clientSafeContext: [] });
    const script = renderGraphHydrationScript(payload, { globalKey: "__DEMO__" });

    // Browser: publish + recover the payload, then hydrate.
    const win = globalThis as Record<string, unknown>;
    new Function("window", script.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""))(win);
    const client = hydrateGraph(readGraphHydrationPayload("__DEMO__")!, { schema: storefrontSchema, adapter });
    delete win["__DEMO__"];

    const product = client.graph.product!({ handle: "cool-shirt" }) as any;
    expect(product.title).toBe("Cool Shirt");
    expect(product.priceRange.minVariantPrice.currencyCode).toBe("USD");
  });
});

/** Evaluate the generated variables factory and assemble a runnable operation. */
function toCompiledOperation(artifact: {
  name: string;
  kind: "query" | "mutation" | "subscription";
  document: string;
  hash: string;
  variablesFactory: { exportName: string; source: string };
  readMap: Record<string, readonly string[]>;
}): CompiledOperation<GraphRouteContext> {
  const fnSrc = artifact.variablesFactory.source.replace(/^export\s+/, "");
  const make = new Function(`${fnSrc}\nreturn ${artifact.variablesFactory.exportName};`);
  const variables = make() as (ctx: GraphRouteContext) => Record<string, unknown>;
  return {
    name: artifact.name,
    kind: artifact.kind,
    document: artifact.document,
    hash: artifact.hash,
    variables,
    readMap: artifact.readMap,
  };
}
