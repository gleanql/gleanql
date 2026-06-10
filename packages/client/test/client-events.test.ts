import { describe, it, expect, vi } from "vitest";
import {
  createFetchAdapter,
  GraphCache,
  normalizeValue,
  GraphScope,
  type GraphHydrationPayload,
  type GraphOperation,
} from "../src/index.js";
import { createGraphClient, type GraphClientEvent } from "../src/glue-client.js";
import { defineSchema } from "@gleanql/core";

// The client glue is browser-only (SSR is a no-op) — simulate a browser.
vi.stubGlobal("window", {});

const schema = defineSchema({ queryType: "Query", types: [] });

function payloadFor(name: string, id: string): GraphHydrationPayload {
  return {
    operationName: name,
    variables: {},
    context: {},
    snapshot: { [`Product:${id}`]: { __typename: "Product", id, title: id } },
    roots: { product: { __typename: "Product", id } },
  } as GraphHydrationPayload;
}

function makeClient(over: { gcKeepPages?: number } = {}) {
  const events: GraphClientEvent[] = [];
  const scope = new GraphScope();
  const client = createGraphClient({
    schema,
    operations: {},
    endpoint: "/graphql",
    scope,
    onEvent: (e) => events.push(e),
    ...over,
  });
  return { client, events, scope };
}

describe("onEvent: gc on navigation (gcKeepPages)", () => {
  it("keeps the freshly-hydrated page and the previous one at gcKeepPages: 2", () => {
    const { client, events } = makeClient({ gcKeepPages: 2 });
    client.hydrate(payloadFor("PageA", "a"));
    client.hydrate(payloadFor("PageB", "b")); // "a" is 1 generation old — kept
    expect(events.filter((e) => e.type === "gc")).toEqual([]);

    client.hydrate(payloadFor("PageC", "c")); // "a" is now 2 generations old — collected
    const gc = events.filter((e) => e.type === "gc");
    expect(gc).toEqual([{ type: "gc", dropped: 1 }]);
  });

  it("gcKeepPages: 1 never collects the page being hydrated", () => {
    const { client, events } = makeClient({ gcKeepPages: 1 });
    client.hydrate(payloadFor("PageA", "a"));
    client.hydrate(payloadFor("PageA", "a")); // same page again — its records are current-generation
    expect(events.filter((e) => e.type === "gc")).toEqual([]);
  });

  it("no gcKeepPages → no automatic collection, no events", () => {
    const { client, events } = makeClient();
    client.hydrate(payloadFor("PageA", "a"));
    client.hydrate(payloadFor("PageB", "b"));
    client.hydrate(payloadFor("PageC", "c"));
    expect(events).toEqual([]);
  });

  it("a throwing listener never breaks navigation", () => {
    const scope = new GraphScope();
    const client = createGraphClient({
      schema,
      operations: {},
      endpoint: "/graphql",
      scope,
      gcKeepPages: 1,
      onEvent: () => {
        throw new Error("listener bug");
      },
    });
    client.hydrate(payloadFor("PageA", "a"));
    client.hydrate(payloadFor("PageB", "b"));
    expect(() => client.hydrate(payloadFor("PageC", "c"))).not.toThrow();
  });
});

describe("onEvent: persisted-retry (adapter observability)", () => {
  it("fires when the server answers PersistedQueryNotFound", async () => {
    const retries: string[] = [];
    const doFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true, status: 200, statusText: "OK",
        json: () => Promise.resolve({ errors: [{ message: "PersistedQueryNotFound" }] }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        ok: true, status: 200, statusText: "OK",
        json: () => Promise.resolve({ data: {} }),
      } as unknown as Response);
    const adapter = createFetchAdapter({
      endpoint: "/graphql",
      fetch: doFetch,
      persisted: true,
      onPersistedRetry: (op) => retries.push(op),
    });
    const op: GraphOperation = { name: "Q", kind: "query", document: "query Q { x }", hash: "f".repeat(64) };
    await adapter.execute(op, {}, {});
    expect(retries).toEqual(["Q"]);
  });
});

describe("onEvent(listener) — runtime registration", () => {
  it("registered listeners receive events alongside the baked option; unsubscribe works", () => {
    const { client, events } = makeClient({ gcKeepPages: 1 });
    const late: GraphClientEvent[] = [];
    const off = client.onEvent((e) => late.push(e));

    client.hydrate(payloadFor("PageA", "a"));
    client.hydrate(payloadFor("PageB", "b")); // collects "a" → one gc event to BOTH listeners
    expect(late).toEqual(events);
    expect(late.length).toBeGreaterThan(0);

    off();
    client.hydrate(payloadFor("PageC", "c"));
    expect(events.length).toBeGreaterThan(late.length); // baked listener kept receiving
  });
});

describe("runOperation (registered / named operations)", () => {
  // Identity needs the type in the schema (identityOf defaults to its `id` field,
  // and `id` only counts when its type is a declared scalar — like generated models).
  const reportSchema = defineSchema({
    queryType: "Query",
    types: [
      { name: "ID", kind: "scalar" },
      { name: "String", kind: "scalar" },
      { name: "Query", kind: "object", fields: { product: { name: "product", type: "Product" } } },
      {
        name: "Product",
        kind: "object",
        fields: {
          id: { name: "id", type: "ID", nonNull: true },
          title: { name: "title", type: "String", nonNull: true },
        },
      },
    ],
  });
  const op = {
    name: "Report",
    kind: "query" as const,
    document: "query Report($handle: String!) { product(handle: $handle) { __typename id title } }",
    hash: "a".repeat(64),
    variables: (ctx: unknown) => ctx as Record<string, unknown>,
    readMap: {},
  };

  function clientWith(fetchMock: ReturnType<typeof vi.fn>) {
    vi.stubGlobal("fetch", fetchMock);
    const events: GraphClientEvent[] = [];
    const scope = new GraphScope();
    const client = createGraphClient({
      schema: reportSchema,
      // the generated operations map shape (CompiledOperation)
      operations: { Report: op as never },
      endpoint: "/graphql",
      scope,
      onEvent: (e) => events.push(e),
    });
    return { client, events, scope };
  }

  it("executes by name with explicit variables and seeds the cache", async () => {
    const doFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      json: () =>
        Promise.resolve({ data: { product: { __typename: "Product", id: "p1", title: "Cool Shirt" } } }),
    } as unknown as Response);
    const { client, scope } = clientWith(doFetch);

    const result = await client.runOperation("Report", { handle: "cool-shirt" });

    expect((result.data as { product: { title: string } }).product.title).toBe("Cool Shirt");
    const sent = JSON.parse((doFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(sent).toMatchObject({ operationName: "Report", variables: { handle: "cool-shirt" } });
    // Seeded: the entity is readable from the normalized cache.
    const cache = scope.current().runtime.cache;
    expect(cache.getField({ __typename: "Product", id: "p1" }, "title")).toEqual({
      status: "ready",
      value: "Cool Shirt",
    });
  });

  it("throws a clear error for an unknown name", async () => {
    const { client } = clientWith(vi.fn());
    await expect(client.runOperation("Nope")).rejects.toThrow(/unknown operation "Nope"/);
  });

  it("reports GraphQL failures on the onEvent channel and still returns the result", async () => {
    const doFetch = vi.fn().mockResolvedValue({
      ok: true, status: 200, statusText: "OK",
      json: () => Promise.resolve({ errors: [{ message: "boom" }] }),
    } as unknown as Response);
    const { client, events } = clientWith(doFetch);
    const result = await client.runOperation("Report", { handle: "x" });
    expect(result.errors).toEqual([{ message: "boom" }]);
    expect(events).toEqual([{ type: "operation-error", operation: "Report", error: "boom" }]);
  });
});

describe("maskViolations (read-masking check)", () => {
  it("flags identified field reads outside the allowed set; skips path records + record-level trackers", async () => {
    const { maskViolations } = await import("../src/reactivity.js");
    const cache = new GraphCache();
    const allowed = new Set(["Product.title", "Product.__typename", "Product.id"]);
    const tracked = new Set([
      cache.fieldTrackingKey("Product:1", "title"), // allowed
      cache.fieldTrackingKey("Product:1", "views"), // VIOLATION — outside the read-map
      cache.fieldTrackingKey("path:Query.search", "total"), // path identity — no typename, skipped
      "Product:1", // record-level tracker (usePaginated) — skipped
    ]);
    expect(maskViolations(cache, allowed, tracked)).toEqual(["Product.views"]);
  });
});

describe("normalizeValue cycle guard", () => {
  it("throws a clear error on cyclic optimistic data instead of overflowing the stack", () => {
    const cache = new GraphCache();
    const a: Record<string, unknown> = { __typename: "Node", id: "1" };
    a.self = a; // user-built cyclic object
    expect(() => normalizeValue(cache, a, "Query", "node")).toThrow(/circular reference/);
  });

  it("still normalizes repeated (non-cyclic) references to the same object", () => {
    const cache = new GraphCache();
    const shared = { __typename: "Image", url: "u" };
    const product = { __typename: "Product", id: "1", a: shared, b: shared };
    expect(() => normalizeValue(cache, product, "Query", "product")).not.toThrow();
  });
});
