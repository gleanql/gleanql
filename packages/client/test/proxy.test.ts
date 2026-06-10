import { describe, it, expect, vi } from "vitest";
import { defineSchema } from "@gleanql/core";
import {
  GraphRuntime,
  bindGraph,
  createGraphProxy,
  selectionOf,
  GraphScope,
  type GraphRef,
  type MissingFieldRead,
  type MissingFieldResult,
} from "../src/index.js";

const schema = defineSchema({
  queryType: "Query",
  types: [
    {
      name: "Query",
      kind: "object",
      fields: {
        product: { name: "product", type: "Product", args: [{ name: "handle", type: "String!" }] },
        products: { name: "products", type: "Product", list: true },
      },
    },
    {
      name: "Product",
      kind: "object",
      fields: {
        id: { name: "id", type: "ID", nonNull: true },
        title: { name: "title", type: "String" },
        descriptionHtml: { name: "descriptionHtml", type: "String" },
        featuredImage: { name: "featuredImage", type: "Image" },
        priceRange: { name: "priceRange", type: "ProductPriceRange" },
        images: { name: "images", type: "Image", list: true },
      },
    },
    {
      name: "Image",
      kind: "object",
      fields: {
        url: { name: "url", type: "String" },
        altText: { name: "altText", type: "String" },
        // A genuinely-callable scalar field (field arguments).
        scaledUrl: { name: "scaledUrl", type: "String", args: [{ name: "transform", type: "ImageTransformInput" }] },
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
  ],
});

const PRODUCT: GraphRef = { __typename: "Product", id: "gid://shopify/Product/1" };
const IMAGE: GraphRef = { path: "Query.product.featuredImage" };
const PRICE: GraphRef = { path: "Query.product.priceRange" };
const MONEY: GraphRef = { path: "Query.product.priceRange.minVariantPrice" };

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
  return { runtime, fetchMissing, flush };
}

/** Seed the canonical ProductRoute shape. */
function seedProductRoute(runtime: GraphRuntime) {
  runtime.seed(PRODUCT, { title: "Cool Shirt", featuredImage: IMAGE, priceRange: PRICE });
  runtime.seed(IMAGE, { url: "https://cdn/shirt.png", altText: null });
  runtime.seed(PRICE, { minVariantPrice: MONEY });
  runtime.seed(MONEY, { amount: "29.00", currencyCode: "USD" });
}

describe("graph proxy: reads", () => {
  it("reads scalar, nested object, and optional-chained fields synchronously", () => {
    const { runtime } = makeRuntime();
    seedProductRoute(runtime);
    const graph = bindGraph({ schema, getRuntime: () => runtime, roots: { product: PRODUCT } });

    const product = graph.product!({ handle: "cool-shirt" }) as any;
    expect(product.title).toBe("Cool Shirt");
    expect(product.featuredImage?.url).toBe("https://cdn/shirt.png");
    expect(product.priceRange.minVariantPrice.amount).toBe("29.00");
    expect(product.priceRange.minVariantPrice.currencyCode).toBe("USD");
  });

  it("returns null for an optional object field that is null (no suspend)", () => {
    const { runtime, fetchMissing } = makeRuntime();
    runtime.seed(PRODUCT, { featuredImage: null });
    const product = createGraphProxy(
      { schema, getRuntime: () => runtime },
      PRODUCT,
      "Product",
    ) as any;
    expect(product.featuredImage).toBeNull();
    expect(fetchMissing).not.toHaveBeenCalled();
  });

  it("wraps list fields as arrays of proxies", () => {
    const { runtime } = makeRuntime();
    const a: GraphRef = { path: "Query.product.images.0" };
    const b: GraphRef = { path: "Query.product.images.1" };
    runtime.seed(PRODUCT, { images: [a, b] });
    runtime.seed(a, { url: "a.png" });
    runtime.seed(b, { url: "b.png" });
    const product = createGraphProxy({ schema, getRuntime: () => runtime }, PRODUCT, "Product") as any;
    expect(product.images.map((i: any) => i.url)).toEqual(["a.png", "b.png"]);
  });

  it("wraps a list root as an array of proxies (glean.products().map)", () => {
    const { runtime } = makeRuntime();
    const p1: GraphRef = { __typename: "Product", id: "1" };
    const p2: GraphRef = { __typename: "Product", id: "2" };
    runtime.seed(p1, { title: "One" });
    runtime.seed(p2, { title: "Two" });
    const graph = bindGraph({ schema, getRuntime: () => runtime, roots: { products: [p1, p2] } });
    const products = graph.products!() as any[];
    expect(products.map((p) => p.title)).toEqual(["One", "Two"]);
  });

  it("returns an empty array for an unseeded list root (no throw)", () => {
    const { runtime } = makeRuntime();
    const graph = bindGraph({ schema, getRuntime: () => runtime, roots: {} });
    expect(graph.products!()).toEqual([]);
  });

  it("attributes reads per binding tracker, even when two bindings interleave", () => {
    const { runtime } = makeRuntime();
    const A: GraphRef = { __typename: "Product", id: "A" };
    const B: GraphRef = { __typename: "Product", id: "B" };
    runtime.seed(A, { id: "A", title: "a" });
    runtime.seed(B, { id: "B", title: "b" });
    const trackerA = new Set<string>();
    const trackerB = new Set<string>();
    // Two renders' graphs, each bound with its own per-render tracker (the useGlean model).
    const graphA = bindGraph({ schema, getRuntime: () => runtime, roots: { product: A }, tracker: trackerA });
    const graphB = bindGraph({ schema, getRuntime: () => runtime, roots: { product: B }, tracker: trackerB });
    const pa = graphA.product!({ handle: "a" }) as any;
    const pb = graphB.product!({ handle: "b" }) as any;

    // Interleave the reads the way concurrent rendering might.
    void pa.title;
    void pb.title;
    void pa.id;

    const has = (set: Set<string>, id: string) => [...set].some((k) => k.startsWith(`Product:${id}`));
    expect(has(trackerA, "A")).toBe(true);
    expect(has(trackerA, "B")).toBe(false); // B's read did NOT leak into A
    expect(has(trackerB, "B")).toBe(true);
    expect(has(trackerB, "A")).toBe(false); // A's reads did NOT leak into B
  });

  it("exposes the hidden selection token via .selection and selectionOf()", () => {
    const { runtime } = makeRuntime();
    seedProductRoute(runtime);
    const product = createGraphProxy({ schema, getRuntime: () => runtime }, PRODUCT, "Product") as any;
    expect(product.selection).toEqual({ ref: PRODUCT, type: "Product" });
    expect(selectionOf(product)).toEqual({ ref: PRODUCT, type: "Product" });
  });
});

describe("graph proxy: callable fields", () => {
  it("reads a lone callable field by its plain name", () => {
    const { runtime } = makeRuntime();
    runtime.seed(IMAGE, { scaledUrl: "plain.png" });
    const image = createGraphProxy({ schema, getRuntime: () => runtime }, IMAGE, "Image") as any;
    expect(image.scaledUrl({ transform: { maxWidth: 300 } })).toBe("plain.png");
  });

  it("reads aliased callable variants by their argument-derived keys", () => {
    const { runtime } = makeRuntime();
    // Two coexisting scaledUrl(transform:) reads were aliased by the compiler.
    runtime.seed(IMAGE, {
      scaledUrl_transformMaxWidth300: "small.png",
      scaledUrl_transformMaxWidth1200: "large.png",
    });
    const image = createGraphProxy({ schema, getRuntime: () => runtime }, IMAGE, "Image") as any;
    expect(image.scaledUrl({ transform: { maxWidth: 300 } })).toBe("small.png");
    expect(image.scaledUrl({ transform: { maxWidth: 1200 } })).toBe("large.png");
  });
});

describe("graph proxy: Suspense on miss", () => {
  it("throws a cached promise for a field absent from the seed, then resolves", async () => {
    const { runtime, fetchMissing, flush } = makeRuntime({ descriptionHtml: "<p>desc</p>" });
    seedProductRoute(runtime);
    const product = createGraphProxy({ schema, getRuntime: () => runtime }, PRODUCT, "Product") as any;

    let thrown: unknown;
    try {
      void product.descriptionHtml;
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Promise);
    await flush();
    expect(product.descriptionHtml).toBe("<p>desc</p>");
    expect(fetchMissing).toHaveBeenCalledTimes(1);
  });
});

describe("graph proxy: read-only / non-spreadable", () => {
  it("rejects writes and exposes no enumerable keys (spread is empty)", () => {
    const { runtime } = makeRuntime();
    seedProductRoute(runtime);
    const product = createGraphProxy({ schema, getRuntime: () => runtime }, PRODUCT, "Product") as any;
    expect(() => {
      product.title = "x";
    }).toThrow(/read-only/);
    expect({ ...product }).toEqual({});
  });
});

describe("GraphScope", () => {
  it("isolates the active runtime per run() and restores the previous one", () => {
    const scope = new GraphScope();
    const a = makeRuntime().runtime;
    const b = makeRuntime().runtime;
    const active = (r: GraphRuntime) => ({ runtime: r, graph: {} as any });

    expect(() => scope.current()).toThrow(/No active graph runtime/);
    scope.run(active(a), () => {
      expect(scope.current().runtime).toBe(a);
      scope.run(active(b), () => expect(scope.current().runtime).toBe(b));
      expect(scope.current().runtime).toBe(a);
    });
    expect(() => scope.current()).toThrow();
  });

  it("set() installs a client singleton", () => {
    const scope = new GraphScope();
    const r = makeRuntime().runtime;
    scope.set({ runtime: r, graph: {} as any });
    expect(scope.current().runtime).toBe(r);
  });
});
