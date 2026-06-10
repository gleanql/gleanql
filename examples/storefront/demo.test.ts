import { describe, it, expect, vi } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeWithTs } from "@gleanql/compiler";
import { renderReadMapTree } from "@gleanql/core";
import { GraphRuntime, type GraphRef, type MissingFieldRead, type MissingFieldResult } from "@gleanql/client";
import { storefrontSchema } from "./graph/schema-model.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * End-to-end example: compile a real route, then drive the runtime with the
 * compiled artifact. Run with `pnpm example` to see the generated operation,
 * variables factory, and read-map tree printed, plus a lazy/missing-field fetch.
 */
describe("storefront example", () => {
  const result = analyzeWithTs({
    fileName: path.join(here, "routes/ProductRoute.tsx"),
    supportDir: path.join(here, "graph"),
    schema: storefrontSchema,
  });
  const op = result.operations[0]!;

  it("compiles the route into one operation + variables + read map", () => {
    console.log("\n--- Compiled GraphQL operation ---\n" + op.document);
    console.log("--- Generated variables factory ---\n" + op.variablesFactory.source);
    console.log("--- Read map (devtools tree) ---\n" + renderReadMapTree(op.name, result.readMap));
    console.log(`--- Operation hash: ${op.hash} | stats: ${JSON.stringify(op.stats)} ---\n`);

    expect(op.document).toContain("product(handle: $handle)");
    expect(op.document).toContain("minVariantPrice");
    expect(result.readMap).toEqual({
      ProductHero: ["Product.title", "Product.featuredImage.url"],
      BuyBox: [
        "Product.priceRange.minVariantPrice.amount",
        "Product.priceRange.minVariantPrice.currencyCode",
      ],
    });
  });

  it("computes request variables from the generated factory", () => {
    const fnSrc = op.variablesFactory.source.replace(/^export\s+/, "");
    const make = new Function(`${fnSrc}\nreturn ${op.variablesFactory.exportName};`);
    const getVariables = make() as (ctx: { params: { handle: string } }) => Record<string, unknown>;
    expect(getVariables({ params: { handle: "cool-shirt" } })).toEqual({ handle: "cool-shirt" });
  });

  it("seeds the cache and reads compiled fields synchronously, lazily fetching the rest", async () => {
    const scheduled: Array<() => void> = [];
    const fetchMissing = vi.fn(
      async (misses: readonly MissingFieldRead[]): Promise<MissingFieldResult[]> =>
        misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: "<p>Lazy description</p>" })),
    );
    const runtime = new GraphRuntime({ fetchMissing, schedule: (cb) => scheduled.push(cb) });

    // Simulate seeding from the executed operation result.
    const productRef: GraphRef = { __typename: "Product", id: "gid://shopify/Product/1" };
    const imageRef: GraphRef = { path: "Query.product(handle).featuredImage" };
    const priceRef: GraphRef = { path: "Query.product(handle).priceRange" };
    const moneyRef: GraphRef = { path: "Query.product(handle).priceRange.minVariantPrice" };
    runtime.seed(productRef, { title: "Cool Shirt", featuredImage: imageRef, priceRange: priceRef });
    runtime.seed(imageRef, { url: "https://cdn/shirt.png" });
    runtime.seed(priceRef, { minVariantPrice: moneyRef });
    runtime.seed(moneyRef, { amount: "29.00", currencyCode: "USD" });

    // Compiled fields read synchronously.
    expect(runtime.readField(productRef, "title")).toBe("Cool Shirt");
    const fi = runtime.readField(productRef, "featuredImage") as GraphRef;
    expect(runtime.readField(fi, "url")).toBe("https://cdn/shirt.png");

    // A lazy field absent from the compiled operation suspends, then resolves
    // through a single batched fetch.
    let thrown: unknown;
    try {
      runtime.readField(productRef, "descriptionHtml");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Promise);
    while (scheduled.length) scheduled.shift()!();
    await thrown;
    expect(runtime.readField(productRef, "descriptionHtml")).toBe("<p>Lazy description</p>");
    expect(fetchMissing).toHaveBeenCalledTimes(1);
  });
});
