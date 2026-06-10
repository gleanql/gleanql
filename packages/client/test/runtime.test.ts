import { describe, it, expect, vi } from "vitest";
import { GraphRuntime, GraphCache, type MissingFieldRead, type MissingFieldResult } from "../src/index.js";

const PRODUCT = { __typename: "Product", id: "gid://shopify/Product/123" } as const;

/** A runtime with a manual scheduler so we can flush batches deterministically. */
function makeRuntime(values: Record<string, unknown>) {
  const scheduled: Array<() => void> = [];
  const fetchMissing = vi.fn(async (misses: readonly MissingFieldRead[]): Promise<MissingFieldResult[]> =>
    misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: values[m.fieldKey] })),
  );
  const runtime = new GraphRuntime({ fetchMissing, schedule: (cb) => scheduled.push(cb) });
  const flush = async () => {
    while (scheduled.length) scheduled.shift()!();
    await Promise.resolve();
    await Promise.resolve();
  };
  return { runtime, fetchMissing, flush };
}

function readOrThrow(fn: () => unknown): { value?: unknown; thrown?: unknown } {
  try {
    return { value: fn() };
  } catch (thrown) {
    return { thrown };
  }
}

describe("runtime: missing-field Suspense", () => {
  it("creates one cached promise and reuses it across reads", async () => {
    const { runtime, fetchMissing } = makeRuntime({ descriptionHtml: "<p>hi</p>" });
    runtime.seed(PRODUCT, { title: "Hi" });

    expect(runtime.readField(PRODUCT, "title")).toBe("Hi");

    const first = readOrThrow(() => runtime.readField(PRODUCT, "descriptionHtml"));
    const second = readOrThrow(() => runtime.readField(PRODUCT, "descriptionHtml"));
    expect(first.thrown).toBeInstanceOf(Promise);
    expect(second.thrown).toBe(first.thrown); // same promise, no new request
    expect(fetchMissing).not.toHaveBeenCalled(); // batched, not yet flushed
  });

  it("resolves the field after the batch flushes", async () => {
    const { runtime, flush } = makeRuntime({ descriptionHtml: "<p>hi</p>" });
    runtime.seed(PRODUCT, { title: "Hi" });
    readOrThrow(() => runtime.readField(PRODUCT, "descriptionHtml"));
    await flush();
    expect(runtime.readField(PRODUCT, "descriptionHtml")).toBe("<p>hi</p>");
  });
});

describe("runtime: batching", () => {
  it("batches multiple misses in one tick into a single fetch", async () => {
    const other = { __typename: "Product", id: "gid://shopify/Product/999" } as const;
    const { runtime, fetchMissing, flush } = makeRuntime({ descriptionHtml: "d", availableForSale: true });
    runtime.seed(PRODUCT, { title: "Hi" });

    readOrThrow(() => runtime.readField(PRODUCT, "descriptionHtml"));
    readOrThrow(() => runtime.readField(other, "availableForSale"));

    await flush();
    expect(fetchMissing).toHaveBeenCalledTimes(1);
    expect(fetchMissing.mock.calls[0]![0]).toHaveLength(2);
  });

  it("does not create a duplicate request for the same field read twice", async () => {
    const { runtime, fetchMissing, flush } = makeRuntime({ descriptionHtml: "d" });
    readOrThrow(() => runtime.readField(PRODUCT, "descriptionHtml"));
    readOrThrow(() => runtime.readField(PRODUCT, "descriptionHtml"));
    await flush();
    expect(fetchMissing).toHaveBeenCalledTimes(1);
    expect(fetchMissing.mock.calls[0]![0]).toHaveLength(1);
  });
});

describe("runtime: cache identity", () => {
  it("normalizes by __typename + id across paths", () => {
    const cache = new GraphCache();
    // Two different query paths return the same entity.
    cache.merge({ __typename: "Product", id: "123" }, { title: "From A" });
    cache.merge({ __typename: "Product", id: "123" }, { handle: "from-b" });
    expect(cache.getField({ __typename: "Product", id: "123" }, "title")).toEqual({ status: "ready", value: "From A" });
    expect(cache.getField({ __typename: "Product", id: "123" }, "handle")).toEqual({ status: "ready", value: "from-b" });
  });

  it("falls back to path identity for objects without id", () => {
    const cache = new GraphCache();
    const ref = { path: "Query.product(handle).featuredImage" };
    cache.merge(ref, { url: "https://img" });
    expect(cache.recordKey(ref)).toBe("path:Query.product(handle).featuredImage");
    expect(cache.getField(ref, "url")).toEqual({ status: "ready", value: "https://img" });
  });
});

describe("runtime: seeding", () => {
  it("reads seeded fields synchronously without suspending", () => {
    const { runtime, fetchMissing } = makeRuntime({});
    runtime.seed(PRODUCT, { title: "Seeded" });
    const result = readOrThrow(() => runtime.readField(PRODUCT, "title"));
    expect(result.value).toBe("Seeded");
    expect(result.thrown).toBeUndefined();
    expect(fetchMissing).not.toHaveBeenCalled();
  });
});

describe("cache/runtime: absorbRecords (RSC per-nav merge)", () => {
  it("folds disjoint snapshots in without dropping existing records", () => {
    const cache = new GraphCache();
    cache.absorbRecords({ "Product:a": { title: "A" } });
    cache.absorbRecords({ "Product:b": { title: "B" } });
    expect(cache.getField({ __typename: "Product", id: "a" }, "title")).toEqual({ status: "ready", value: "A" });
    expect(cache.getField({ __typename: "Product", id: "b" }, "title")).toEqual({ status: "ready", value: "B" });
  });

  it("unions fields on the same entity (newer page adds a field, doesn't clobber)", () => {
    const cache = new GraphCache();
    cache.absorbRecords({ "Product:a": { title: "A" } });
    cache.absorbRecords({ "Product:a": { views: 7 } });
    const ref = { __typename: "Product", id: "a" } as const;
    expect(cache.getField(ref, "title")).toEqual({ status: "ready", value: "A" });
    expect(cache.getField(ref, "views")).toEqual({ status: "ready", value: 7 });
  });

  it("is idempotent and write-only: re-absorbing changes nothing and never notifies", () => {
    const cache = new GraphCache();
    const listener = vi.fn();
    cache.subscribe(listener);

    expect(cache.absorbRecords({ "Product:a": { title: "A" } })).toBe(true);
    expect(cache.absorbRecords({ "Product:a": { title: "A" } })).toBe(false); // no change
    expect(cache.version).toBe(0); // absorbRecords NEVER bumps — caller notifies
    expect(listener).not.toHaveBeenCalled();
  });

  it("reports a real change when a field value differs", () => {
    const cache = new GraphCache();
    cache.absorbRecords({ "Product:a": { title: "A" } });
    expect(cache.absorbRecords({ "Product:a": { title: "A2" } })).toBe(true);
    expect(cache.getField({ __typename: "Product", id: "a" }, "title")).toEqual({ status: "ready", value: "A2" });
  });

  it("runtime.absorb notifies subscribers once for a multi-record change", () => {
    const { runtime } = makeRuntime({});
    const listener = vi.fn();
    runtime.cache.subscribe(listener);
    const changed = runtime.absorb({ "Product:a": { title: "A" }, "Product:b": { title: "B" } });
    expect(changed).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    // A no-op absorb does not notify.
    runtime.absorb({ "Product:a": { title: "A" } });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("cache: LRU eviction (opt-in maxRecords)", () => {
  const r = (id: string) => ({ __typename: "Product", id }) as const;

  it("is unbounded by default", () => {
    const cache = new GraphCache();
    for (let i = 0; i < 50; i++) cache.setField(r(String(i)), "title", i);
    expect(cache.hasRecord(r("0"))).toBe(true);
    expect(cache.hasRecord(r("49"))).toBe(true);
  });

  it("evicts the least-recently-used record past the cap", () => {
    const cache = new GraphCache(2);
    cache.setField(r("a"), "title", "A");
    cache.setField(r("b"), "title", "B");
    cache.setField(r("c"), "title", "C"); // over cap → evict oldest (a)
    expect(cache.hasRecord(r("a"))).toBe(false);
    expect(cache.hasRecord(r("b"))).toBe(true);
    expect(cache.hasRecord(r("c"))).toBe(true);
  });

  it("a read marks a record recently-used, sparing it", () => {
    const cache = new GraphCache(2);
    cache.setField(r("a"), "title", "A");
    cache.setField(r("b"), "title", "B");
    cache.getField(r("a"), "title"); // touch a → b is now oldest
    cache.setField(r("c"), "title", "C"); // evict b, keep a + c
    expect(cache.hasRecord(r("a"))).toBe(true);
    expect(cache.hasRecord(r("b"))).toBe(false);
    expect(cache.hasRecord(r("c"))).toBe(true);
  });
});

describe("runtime: invalidation (mutation-ready)", () => {
  it("re-fetches a field after its record is invalidated", async () => {
    const { runtime, fetchMissing, flush } = makeRuntime({ title: "Refetched" });
    runtime.seed(PRODUCT, { title: "Original" });
    expect(runtime.readField(PRODUCT, "title")).toBe("Original");

    runtime.invalidate(PRODUCT);
    const after = readOrThrow(() => runtime.readField(PRODUCT, "title"));
    expect(after.thrown).toBeInstanceOf(Promise);
    await flush();
    expect(runtime.readField(PRODUCT, "title")).toBe("Refetched");
    expect(fetchMissing).toHaveBeenCalledTimes(1);
  });
});

describe("runtime: strict mode", () => {
  it("throws on unexpected missing field when configured to error", () => {
    const runtime = new GraphRuntime({
      fetchMissing: async () => [],
      unexpectedMissingField: "error",
    });
    expect(() => runtime.readField(PRODUCT, "descriptionHtml")).toThrow(/was not in the compiled operation/);
  });
});
