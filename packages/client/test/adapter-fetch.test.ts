import { describe, it, expect, vi } from "vitest";
import { createFetchAdapter, type GraphOperation } from "../src/index.js";

/** A fake `fetch` returning a canned Response-like object. */
function fakeFetch(body: string, init: { ok?: boolean; status?: number; statusText?: string } = {}) {
  const res = {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    statusText: init.statusText ?? "OK",
    json: () => Promise.resolve(JSON.parse(body)),
  };
  return vi.fn(() => Promise.resolve(res as unknown as Response));
}

const QUERY: GraphOperation = { name: "GetProduct", kind: "query", document: "query GetProduct { product { id } }" };

describe("fetch adapter: execute", () => {
  it("POSTs document + variables + operationName and returns the parsed result", async () => {
    const doFetch = fakeFetch(JSON.stringify({ data: { product: { id: "1" } } }));
    const adapter = createFetchAdapter({ endpoint: "/graphql", fetch: doFetch });

    const result = await adapter.execute(QUERY, { handle: "cool-shirt" }, {});

    expect(result).toEqual({ data: { product: { id: "1" } } });
    expect(doFetch).toHaveBeenCalledWith("/graphql", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: QUERY.document, variables: { handle: "cool-shirt" }, operationName: "GetProduct" }),
    });
  });

  it("returns a GraphQL error body as-is (errors ride the result, not exceptions)", async () => {
    const doFetch = fakeFetch(JSON.stringify({ errors: [{ message: "boom" }] }), { ok: false, status: 400 });
    const adapter = createFetchAdapter({ endpoint: "/graphql", fetch: doFetch });
    expect(await adapter.execute(QUERY, {}, {})).toEqual({ errors: [{ message: "boom" }] });
  });

  it("throws a clear transport error on a non-JSON response (proxy HTML, empty body)", async () => {
    const doFetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 502,
        statusText: "Bad Gateway",
        json: () => Promise.reject(new SyntaxError("Unexpected token <")),
      } as unknown as Response),
    );
    const adapter = createFetchAdapter({ endpoint: "/graphql", fetch: doFetch });
    await expect(adapter.execute(QUERY, {}, {})).rejects.toThrow(
      "graph fetch: non-JSON response (502 Bad Gateway) from /graphql",
    );
  });

  it("merges context-derived headers from the headers builder", async () => {
    const doFetch = fakeFetch(JSON.stringify({ data: {} }));
    const adapter = createFetchAdapter({
      endpoint: "/graphql",
      fetch: doFetch,
      headers: (ctx) => ({ authorization: `Bearer ${(ctx as { token?: string }).token}` }),
    });
    await adapter.execute(QUERY, {}, { token: "secret" });
    expect(doFetch).toHaveBeenCalledWith(
      "/graphql",
      expect.objectContaining({
        headers: { "content-type": "application/json", authorization: "Bearer secret" },
      }),
    );
  });
});

describe("fetch adapter: subscribe (SSE)", () => {
  it("yields an immediately-done stream when EventSource is unavailable (server)", async () => {
    const adapter = createFetchAdapter({ endpoint: "/graphql", fetch: fakeFetch("{}") });
    const it = adapter.subscribe!(QUERY, {}, {})[Symbol.asyncIterator]();
    expect(await it.next()).toEqual({ value: undefined, done: true });
  });
});
