import { bench, describe } from "vitest";
import { GraphRuntime, bindGraph } from "../src/index.js";
import { affectedDigest } from "../src/reactivity.js";
import { defineSchema } from "@gleanql/core";

/**
 * Runtime hot paths, isolated:
 *
 * - warm proxy reads — what every component render pays per field
 * - a write + the notify sweep over N mounted components' tracked sets — the
 *   cost of "one record changed, who re-renders?" at field granularity
 *
 * Run with: pnpm bench
 */

const schema = defineSchema({
  queryType: "Query",
  types: [
    {
      name: "Query",
      kind: "object",
      fields: { product: { name: "product", type: "Product", args: [{ name: "handle", type: "String!" }] } },
    },
    {
      name: "Product",
      kind: "object",
      fields: {
        id: { name: "id", type: "ID", nonNull: true },
        title: { name: "title", type: "String" },
        views: { name: "views", type: "Int" },
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
      fields: { amount: { name: "amount", type: "String" }, currencyCode: { name: "currencyCode", type: "String" } },
    },
  ],
});

function seededRuntime(products: number) {
  const runtime = new GraphRuntime({
    keyOf: (typename, obj) => schema.identityOf(typename, obj),
    fetchMissing: async (misses) => misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: undefined })),
  });
  const data: Record<string, unknown> = {};
  for (let i = 0; i < products; i++) {
    data[`product${i}`] = {
      __typename: "Product",
      id: `p${i}`,
      title: `Product ${i}`,
      views: i,
      priceRange: {
        __typename: "ProductPriceRange",
        minVariantPrice: { __typename: "MoneyV2", amount: `${i}.00`, currencyCode: "USD" },
      },
    };
  }
  const roots = runtime.seedResult(data);
  return { runtime, roots };
}

describe("cache reads", () => {
  const { runtime, roots } = seededRuntime(1);
  const glean = bindGraph({ schema, getRuntime: () => runtime, roots: { product: roots.product0! } });

  bench("warm nested read (3 hops, fresh proxy chain)", () => {
    const p = (glean as any).product({ handle: "x" });
    void p.priceRange.minVariantPrice.amount;
  });
});

describe("write → who re-renders (1000 mounted components, field-grained)", () => {
  const { runtime } = seededRuntime(1000);
  const cache = runtime.cache;

  // Each "component" tracked one field of its own product — the useGlean shape.
  const trackedSets: Array<ReadonlySet<string>> = [];
  const baselines: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const key = cache.fieldTrackingKey(`Product:p${i}`, "title");
    const set = new Set([key]);
    trackedSets.push(set);
    baselines.push(affectedDigest(cache, set));
  }

  let v = 0;
  bench("merge one field + digest-check all 1000 subscribers", () => {
    cache.merge({ __typename: "Product", id: "p500" }, { title: `Renamed ${v++}` });
    let woken = 0;
    for (let i = 0; i < 1000; i++) {
      if (affectedDigest(cache, trackedSets[i]!) !== baselines[i]) woken++;
    }
    if (woken !== 1) throw new Error(`expected exactly 1 affected component, got ${woken}`);
    baselines[500] = affectedDigest(cache, trackedSets[500]!);
  });
});
