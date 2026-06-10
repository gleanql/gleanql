import { describe, it, expect } from "vitest";
import { GraphCache, type GraphRef } from "../src/cache.js";
import { affectedDigest } from "../src/glue-client.js";
import { createGraphProxy, setReadTracker } from "../src/proxy.js";
import { GraphRuntime } from "../src/runtime.js";
import { defineSchema } from "@gleanql/core";

const A: GraphRef = { __typename: "Product", id: "1" };
const B: GraphRef = { __typename: "Product", id: "2" };

describe("cache: per-record versions", () => {
  it("bumps only the touched record's version", () => {
    const cache = new GraphCache();
    expect(cache.recordVersion(cache.recordKey(A))).toBe(0);

    cache.setField(A, "title", "x");
    const vA = cache.recordVersion(cache.recordKey(A));
    expect(vA).toBe(1);
    expect(cache.recordVersion(cache.recordKey(B))).toBe(0); // untouched

    cache.merge(A, { title: "y", subtitle: "z" });
    expect(cache.recordVersion(cache.recordKey(A))).toBe(2);
    expect(cache.recordVersion(cache.recordKey(B))).toBe(0);

    cache.invalidate(A);
    expect(cache.recordVersion(cache.recordKey(A))).toBe(3);
  });

  it("absorbRecords bumps versions for changed records without notifying", () => {
    const cache = new GraphCache();
    let notifies = 0;
    cache.subscribe(() => notifies++);
    const changed = cache.absorbRecords({ "Product:1": { title: "x" } });
    expect(changed).toBe(true);
    expect(cache.recordVersion("Product:1")).toBe(1);
    expect(notifies).toBe(0); // absorb defers the global notify to the caller

    // Re-absorbing identical data is a no-op (no version bump).
    cache.absorbRecords({ "Product:1": { title: "x" } });
    expect(cache.recordVersion("Product:1")).toBe(1);
  });

  it("keeps the global version + subscribe channel intact (back-compat)", () => {
    const cache = new GraphCache();
    let notifies = 0;
    cache.subscribe(() => notifies++);
    cache.setField(A, "title", "x");
    cache.setField(B, "title", "y");
    expect(cache.version).toBe(2);
    expect(notifies).toBe(2);
  });
});

describe("affectedDigest: gates fine-grained re-render", () => {
  it("is stable across a write to an untracked record, and changes on a tracked one", () => {
    const cache = new GraphCache();
    const tracked = new Set([cache.recordKey(A)]);

    const d0 = affectedDigest(cache, tracked);
    cache.setField(B, "title", "x"); // untracked → digest unchanged
    expect(affectedDigest(cache, tracked)).toBe(d0);

    cache.setField(A, "title", "y"); // tracked → digest changes
    expect(affectedDigest(cache, tracked)).not.toBe(d0);
  });

  it("an empty tracking set never changes (component reads no graph fields)", () => {
    const cache = new GraphCache();
    const empty = new Set<string>();
    const d0 = affectedDigest(cache, empty);
    cache.setField(A, "title", "x");
    expect(affectedDigest(cache, empty)).toBe(d0);
    expect(d0).toBe("");
  });

  it("field-level: a tracker on one field ignores a write to another field of the SAME record", () => {
    const cache = new GraphCache();
    const titleKey = cache.fieldTrackingKey(cache.recordKey(A), "title");
    const tracked = new Set([titleKey]);

    const d0 = affectedDigest(cache, tracked);
    cache.setField(A, "views", 1); // same record, different field → digest unchanged
    expect(affectedDigest(cache, tracked)).toBe(d0);

    cache.setField(A, "title", "y"); // the tracked field → digest changes
    expect(affectedDigest(cache, tracked)).not.toBe(d0);
  });

  it("record-level trackers (usePaginated) still wake on any field write", () => {
    const cache = new GraphCache();
    const tracked = new Set([cache.recordKey(A)]); // bare record key
    const d0 = affectedDigest(cache, tracked);
    cache.setField(A, "views", 1); // any field → record version bumps → digest changes
    expect(affectedDigest(cache, tracked)).not.toBe(d0);
  });

  it("invalidate() wakes field-level trackers of the dropped record", () => {
    const cache = new GraphCache();
    cache.setField(A, "title", "x");
    const tracked = new Set([cache.fieldTrackingKey(cache.recordKey(A), "title")]);
    const d0 = affectedDigest(cache, tracked);
    cache.invalidate(A);
    expect(affectedDigest(cache, tracked)).not.toBe(d0);
  });
});

describe("proxy read tracking", () => {
  const schema = defineSchema({
    queryType: "Query",
    types: [
      { name: "Query", kind: "object", fields: { product: { name: "product", type: "Product" } } },
      {
        name: "Product",
        kind: "object",
        fields: {
          id: { name: "id", type: "ID", nonNull: true },
          title: { name: "title", type: "String", nonNull: true },
          featuredImage: { name: "featuredImage", type: "Image" },
        },
      },
      { name: "Image", kind: "object", fields: { url: { name: "url", type: "String", nonNull: true } } },
      { name: "String", kind: "scalar" },
      { name: "ID", kind: "scalar" },
    ],
  });

  it("records the exact field a render reads, and ignores reads outside a tracker", () => {
    const runtime = new GraphRuntime({
      keyOf: (typename, obj) => schema.identityOf(typename, obj),
      fetchMissing: async (m) => m.map((x) => ({ ref: x.ref, fieldKey: x.fieldKey, value: undefined })),
    });
    runtime.seed(A, { title: "Cool", views: 1 });
    const product = createGraphProxy({ schema, getRuntime: () => runtime }, A, "Product");

    // Untracked read: nothing recorded.
    setReadTracker(null);
    void (product as { title: string }).title;

    // Tracked read populates the active set with the exact field key (not the bare record).
    const tracking = new Set<string>();
    setReadTracker(tracking);
    void (product as { title: string }).title;
    setReadTracker(null);

    const titleKey = runtime.cache.fieldTrackingKey(runtime.cache.recordKey(A), "title");
    expect(tracking.has(titleKey)).toBe(true);
    expect(tracking.has(runtime.cache.fieldTrackingKey(runtime.cache.recordKey(A), "views"))).toBe(false);
  });
});
