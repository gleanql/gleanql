import { describe, it, expect, vi } from "vitest";
import { GraphCache, type GraphRef } from "../src/index.js";

const ref = (id: string): GraphRef => ({ __typename: "Product", id });

describe("GraphCache LRU eviction (maxRecords)", () => {
  it("evicts the least-recently-used record past the cap", () => {
    const cache = new GraphCache(2);
    cache.setField(ref("a"), "title", "A");
    cache.setField(ref("b"), "title", "B");
    cache.setField(ref("c"), "title", "C"); // over cap → "a" (oldest) goes

    expect(cache.hasRecord(ref("a"))).toBe(false);
    expect(cache.getField(ref("b"), "title")).toEqual({ status: "ready", value: "B" });
    expect(cache.getField(ref("c"), "title")).toEqual({ status: "ready", value: "C" });
  });

  it("a read marks the record recently-used, changing the eviction victim", () => {
    const cache = new GraphCache(2);
    cache.setField(ref("a"), "title", "A");
    cache.setField(ref("b"), "title", "B");
    cache.getField(ref("a"), "title"); // touch "a" → "b" is now the LRU
    cache.setField(ref("c"), "title", "C");

    expect(cache.hasRecord(ref("a"))).toBe(true);
    expect(cache.hasRecord(ref("b"))).toBe(false);
  });

  it("merge() also enforces the cap", () => {
    const cache = new GraphCache(1);
    cache.merge(ref("a"), { title: "A" });
    cache.merge(ref("b"), { title: "B" });
    expect(cache.hasRecord(ref("a"))).toBe(false);
    expect(cache.hasRecord(ref("b"))).toBe(true);
  });

  it("fromSnapshot() trims an oversized snapshot to the cap", () => {
    const big = new GraphCache();
    big.setField(ref("a"), "title", "A");
    big.setField(ref("b"), "title", "B");
    big.setField(ref("c"), "title", "C");

    const capped = GraphCache.fromSnapshot(big.snapshot(), 2);
    expect(capped.hasRecord(ref("a"))).toBe(false);
    expect(capped.hasRecord(ref("b"))).toBe(true);
    expect(capped.hasRecord(ref("c"))).toBe(true);
  });

  it("default (no cap) never evicts", () => {
    const cache = new GraphCache();
    for (let i = 0; i < 100; i++) cache.setField(ref(String(i)), "title", String(i));
    expect(cache.hasRecord(ref("0"))).toBe(true);
    expect(cache.hasRecord(ref("99"))).toBe(true);
  });
});

describe("GraphCache retention (retain/release + gc)", () => {
  it("a retained record is never the LRU eviction victim", () => {
    const cache = new GraphCache(2);
    cache.setField(ref("a"), "title", "A");
    const release = cache.retain(cache.recordKey(ref("a")));
    cache.setField(ref("b"), "title", "B");
    cache.setField(ref("c"), "title", "C"); // over cap — "a" is oldest but retained

    expect(cache.hasRecord(ref("a"))).toBe(true);
    expect(cache.hasRecord(ref("b"))).toBe(false); // next-oldest unretained goes instead
    expect(cache.hasRecord(ref("c"))).toBe(true);
    release();
  });

  it("gc() drops exactly the unretained records and notifies once", () => {
    const cache = new GraphCache();
    cache.setField(ref("a"), "title", "A");
    cache.setField(ref("b"), "title", "B");
    const release = cache.retain(cache.recordKey(ref("a")));
    const listener = vi.fn();
    cache.subscribe(listener);

    expect(cache.gc()).toBe(1);
    expect(cache.hasRecord(ref("a"))).toBe(true);
    expect(cache.hasRecord(ref("b"))).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    release();
    expect(cache.gc()).toBe(1); // released → collectable
    expect(cache.hasRecord(ref("a"))).toBe(false);
    expect(cache.gc()).toBe(0); // empty sweep doesn't notify
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("retention is reference-counted; release is idempotent", () => {
    const cache = new GraphCache();
    cache.setField(ref("a"), "title", "A");
    const key = cache.recordKey(ref("a"));
    const r1 = cache.retain(key);
    const r2 = cache.retain(key);
    r1();
    r1(); // double-release must not steal r2's count
    expect(cache.isRetained(key)).toBe(true);
    r2();
    expect(cache.isRetained(key)).toBe(false);
  });

  it("versions survive gc, so a refetched record stays monotonic for trackers", () => {
    const cache = new GraphCache();
    cache.setField(ref("a"), "title", "A");
    const key = cache.recordKey(ref("a"));
    const v = cache.recordVersion(key);
    cache.gc();
    cache.setField(ref("a"), "title", "A2"); // refetched after collection
    expect(cache.recordVersion(key)).toBeGreaterThan(v);
  });
});

describe("GraphCache staleness-aware gc (keepEpochs)", () => {
  it("keeps unretained records that are still fresh; collects only the stale", () => {
    const cache = new GraphCache();
    cache.setField(ref("old"), "title", "Old"); // epoch 0

    cache.advanceEpoch(); // navigation 1
    cache.setField(ref("new"), "title", "New"); // epoch 1

    // keepEpochs: 2 — "old" (1 generation stale) is still within the window.
    expect(cache.gc({ keepEpochs: 2 })).toBe(0);

    cache.advanceEpoch(); // navigation 2 — "old" is now 2 generations stale
    expect(cache.gc({ keepEpochs: 2 })).toBe(1);
    expect(cache.hasRecord(ref("old"))).toBe(false);
    expect(cache.hasRecord(ref("new"))).toBe(true);
  });

  it("a read refreshes a record's generation (back-nav data stays warm)", () => {
    const cache = new GraphCache();
    cache.setField(ref("a"), "title", "A");
    cache.advanceEpoch();
    cache.getField(ref("a"), "title"); // read on the new page re-stamps it
    cache.advanceEpoch();
    expect(cache.gc({ keepEpochs: 2 })).toBe(0); // 1 generation stale < 2
  });

  it("retained records survive regardless of staleness", () => {
    const cache = new GraphCache();
    cache.setField(ref("pinned"), "title", "P");
    const release = cache.retain(cache.recordKey(ref("pinned")));
    for (let i = 0; i < 5; i++) cache.advanceEpoch();
    expect(cache.gc({ keepEpochs: 1 })).toBe(0);
    release();
    expect(cache.gc({ keepEpochs: 1 })).toBe(1);
  });

  it("gc() without keepEpochs keeps the full-reset semantics", () => {
    const cache = new GraphCache();
    cache.setField(ref("fresh"), "title", "F"); // current epoch — fresh, but unretained
    expect(cache.gc()).toBe(1);
  });
});

describe("syncRetention (hook integration logic)", () => {
  it("retains this render's records, releases dropped ones, releases all on unmount", async () => {
    const { syncRetention, releaseRetention } = await import("../src/reactivity.js");
    const cache = new GraphCache();
    cache.setField(ref("a"), "title", "A");
    cache.setField(ref("b"), "title", "B");
    const keyA = cache.recordKey(ref("a"));
    const keyB = cache.recordKey(ref("b"));
    const held = new Map<string, () => void>();

    // Render 1 reads a field of "a" (tracked keys are record\0field form).
    syncRetention(cache, held, new Set([cache.fieldTrackingKey(keyA, "title")]));
    expect(cache.isRetained(keyA)).toBe(true);

    // Render 2 reads "b" instead — "a" is released, "b" retained.
    syncRetention(cache, held, new Set([keyB]));
    expect(cache.isRetained(keyA)).toBe(false);
    expect(cache.isRetained(keyB)).toBe(true);

    // Unmount releases everything.
    releaseRetention(held);
    expect(cache.isRetained(keyB)).toBe(false);
    expect(cache.gc()).toBe(2);
  });
});

describe("GraphCache.invalidateField", () => {
  it("drops only the one field; siblings stay readable", () => {
    const cache = new GraphCache();
    cache.merge(ref("1"), { title: "Shirt", views: 10 });

    cache.invalidateField(ref("1"), "views");

    expect(cache.getField(ref("1"), "views")).toEqual({ status: "missing" });
    expect(cache.getField(ref("1"), "title")).toEqual({ status: "ready", value: "Shirt" });
  });

  it("bumps the field + record versions and notifies, so trackers re-render", () => {
    const cache = new GraphCache();
    cache.setField(ref("1"), "views", 10);
    const recordKey = cache.recordKey(ref("1"));
    const fieldV = cache.fieldVersion(recordKey, "views");
    const recordV = cache.recordVersion(recordKey);
    const listener = vi.fn();
    cache.subscribe(listener);

    cache.invalidateField(ref("1"), "views");

    expect(cache.fieldVersion(recordKey, "views")).toBe(fieldV + 1);
    expect(cache.recordVersion(recordKey)).toBe(recordV + 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is safe on a record that was never written", () => {
    const cache = new GraphCache();
    expect(() => cache.invalidateField(ref("ghost"), "title")).not.toThrow();
    expect(cache.getField(ref("ghost"), "title")).toEqual({ status: "missing" });
  });
});
