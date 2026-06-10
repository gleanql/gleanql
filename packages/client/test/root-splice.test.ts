import { describe, it, expect } from "vitest";
import { spliceRootList, refOf, seedableFields, createMembershipTx } from "../src/glue-client.js";
import type { GraphRef, FieldValue } from "../src/index.js";

// The cache's record key, inlined for the test (entity by __typename:id, id-less by path).
const key = (v: FieldValue): string | undefined => {
  const r = v as { __typename?: unknown; id?: unknown; path?: unknown };
  if (typeof r?.__typename === "string" && r?.id != null) return `${r.__typename}:${String(r.id)}`;
  if (typeof r?.path === "string") return r.path;
  return undefined;
};

const A: GraphRef = { __typename: "Todo", id: "a" };
const B: GraphRef = { __typename: "Todo", id: "b" };
const C: GraphRef = { __typename: "Todo", id: "c" };

describe("spliceRootList (optimistic list-root membership)", () => {
  it("appends to the end by default", () => {
    expect(spliceRootList({ todos: [A, B] }, "todos", C, key, {})).toEqual({ todos: [A, B, C] });
  });

  it("prepends with { prepend }", () => {
    expect(spliceRootList({ todos: [A, B] }, "todos", C, key, { prepend: true })).toEqual({ todos: [C, A, B] });
  });

  it("dedupes — re-adding an existing entity moves it rather than duplicating", () => {
    expect(spliceRootList({ todos: [A, B] }, "todos", A, key, {})).toEqual({ todos: [B, A] });
  });

  it("removes with { remove }", () => {
    expect(spliceRootList({ todos: [A, B, C] }, "todos", B, key, { remove: true })).toEqual({ todos: [A, C] });
  });

  it("inserts at an index with { at } (restoring a removed row's position)", () => {
    expect(spliceRootList({ todos: [A, C] }, "todos", B, key, { at: 1 })).toEqual({ todos: [A, B, C] });
  });

  it("clamps an out-of-range { at } to the end", () => {
    expect(spliceRootList({ todos: [A, B] }, "todos", C, key, { at: 99 })).toEqual({ todos: [A, B, C] });
  });

  it("remove-then-reinsert-at restores the original order exactly", () => {
    const start = { todos: [A, B, C] };
    const removed = spliceRootList(start, "todos", B, key, { remove: true }); // { todos: [A, C] }
    expect(spliceRootList(removed, "todos", B, key, { at: 1 })).toEqual(start);
  });

  it("treats a missing/empty root as an empty list", () => {
    expect(spliceRootList({}, "todos", A, key, {})).toEqual({ todos: [A] });
  });

  it("leaves other roots untouched", () => {
    expect(spliceRootList({ todos: [A], board: [B] }, "todos", C, key, {})).toEqual({ todos: [A, C], board: [B] });
  });

  it("does not mutate the input roots", () => {
    const roots = { todos: [A, B] };
    spliceRootList(roots, "todos", C, key, {});
    expect(roots).toEqual({ todos: [A, B] });
  });
});

describe("refOf", () => {
  it("reads __typename + id off a raw entity (a mutation result)", () => {
    expect(refOf({ __typename: "Todo", id: "a", title: "x", completed: false })).toEqual({ __typename: "Todo", id: "a" });
  });

  it("coerces a non-string id", () => {
    expect(refOf({ __typename: "Todo", id: 7 })).toEqual({ __typename: "Todo", id: "7" });
  });

  it("reads a path ref", () => {
    expect(refOf({ path: "Query.todos" })).toEqual({ path: "Query.todos" });
  });

  it("returns undefined for scalars and unidentifiable objects", () => {
    expect(refOf("a")).toBeUndefined();
    expect(refOf(null)).toBeUndefined();
    expect(refOf(42)).toBeUndefined();
    expect(refOf({ title: "no identity" })).toBeUndefined();
  });
});

describe("seedableFields (optimistic entity seeding)", () => {
  it("returns the data fields of a client-built entity, including id (a proxy reads .id as a field)", () => {
    expect(seedableFields({ __typename: "Todo", id: "a", title: "x", completed: false })).toEqual({
      id: "a",
      title: "x",
      completed: false,
    });
  });

  it("returns undefined for a bare ref — only identity, nothing to render", () => {
    expect(seedableFields({ __typename: "Todo", id: "a" })).toBeUndefined();
  });

  it("returns undefined for unidentified objects and non-objects", () => {
    expect(seedableFields({ title: "x" })).toBeUndefined();
    expect(seedableFields("a")).toBeUndefined();
    expect(seedableFields(null)).toBeUndefined();
  });
});

describe("createMembershipTx (optimistic mutation rollback)", () => {
  function fakeOps() {
    const calls: unknown[][] = [];
    return {
      calls,
      append: (f: string, e: unknown, o?: unknown) => calls.push(["append", f, (e as { id: string }).id, o]),
      remove: (f: string, e: unknown) => calls.push(["remove", f, (e as { id: string }).id]),
      indexOf: () => 2,
      evictOptimistic: (e: unknown) => calls.push(["evict", (e as { id: string }).id]),
    };
  }

  it("append → rollback removes the entity and evicts its optimistic record", () => {
    const ops = fakeOps();
    const tx = createMembershipTx(ops);
    tx.membership.append("todos", { __typename: "Todo", id: "a", title: "x" }, { prepend: true });
    expect(ops.calls).toEqual([["append", "todos", "a", { prepend: true }]]);
    tx.rollback();
    expect(ops.calls).toEqual([
      ["append", "todos", "a", { prepend: true }],
      ["remove", "todos", "a"],
      ["evict", "a"],
    ]);
  });

  it("remove → rollback re-appends at the captured index", () => {
    const ops = fakeOps();
    const tx = createMembershipTx(ops);
    tx.membership.remove("todos", { __typename: "Todo", id: "b" });
    expect(ops.calls).toEqual([["remove", "todos", "b"]]);
    tx.rollback();
    expect(ops.calls).toEqual([
      ["remove", "todos", "b"],
      ["append", "todos", "b", { at: 2 }],
    ]);
  });

  it("rolls back multiple ops in reverse order", () => {
    const ops = fakeOps();
    const tx = createMembershipTx(ops);
    tx.membership.remove("todos", { __typename: "Todo", id: "x" });
    tx.membership.remove("todos", { __typename: "Todo", id: "y" });
    ops.calls.length = 0; // ignore the applies; assert only the rollback order
    tx.rollback();
    expect(ops.calls).toEqual([
      ["append", "todos", "y", { at: 2 }], // y undone first (reverse)
      ["append", "todos", "x", { at: 2 }],
    ]);
  });
});
