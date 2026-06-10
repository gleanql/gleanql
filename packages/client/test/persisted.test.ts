import { describe, it, expect, vi } from "vitest";
import { createFetchAdapter, createPersistedResolver, type GraphOperation } from "../src/index.js";

const OP: GraphOperation = {
  name: "GetProduct",
  kind: "query",
  document: "query GetProduct { product { id } }",
  hash: "a".repeat(64),
};

function jsonFetch(...responses: unknown[]) {
  const fn = vi.fn();
  for (const body of responses) {
    fn.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: () => Promise.resolve(body),
    } as unknown as Response);
  }
  return fn;
}

const sentBody = (fetchMock: ReturnType<typeof vi.fn>, call = 0): Record<string, unknown> =>
  JSON.parse((fetchMock.mock.calls[call]![1] as RequestInit).body as string);

describe("fetch adapter: persisted mode", () => {
  it("sends hash-only (no document) with the APQ extension", async () => {
    const doFetch = jsonFetch({ data: { product: { id: "1" } } });
    const adapter = createFetchAdapter({ endpoint: "/graphql", fetch: doFetch, persisted: true });

    const result = await adapter.execute(OP, { handle: "x" }, {});

    expect(result).toEqual({ data: { product: { id: "1" } } });
    expect(sentBody(doFetch)).toEqual({
      operationName: "GetProduct",
      variables: { handle: "x" },
      extensions: { persistedQuery: { version: 1, sha256Hash: OP.hash } },
    });
  });

  it("retries ONCE with the full document on PersistedQueryNotFound (APQ register)", async () => {
    const doFetch = jsonFetch(
      { errors: [{ message: "PersistedQueryNotFound" }] },
      { data: { product: { id: "1" } } },
    );
    const adapter = createFetchAdapter({ endpoint: "/graphql", fetch: doFetch, persisted: true });

    const result = await adapter.execute(OP, {}, {});

    expect(result).toEqual({ data: { product: { id: "1" } } });
    expect(doFetch).toHaveBeenCalledTimes(2);
    expect(sentBody(doFetch, 0).query).toBeUndefined();
    expect(sentBody(doFetch, 1)).toMatchObject({
      query: OP.document,
      extensions: { persistedQuery: { version: 1, sha256Hash: OP.hash } },
    });
  });

  it("does not retry on other GraphQL errors", async () => {
    const doFetch = jsonFetch({ errors: [{ message: "boom" }] });
    const adapter = createFetchAdapter({ endpoint: "/graphql", fetch: doFetch, persisted: true });
    expect(await adapter.execute(OP, {}, {})).toEqual({ errors: [{ message: "boom" }] });
    expect(doFetch).toHaveBeenCalledTimes(1);
  });

  it("falls back to sending the document for operations without a hash", async () => {
    const doFetch = jsonFetch({ data: {} });
    const adapter = createFetchAdapter({ endpoint: "/graphql", fetch: doFetch, persisted: true });
    await adapter.execute({ name: "Q", kind: "query", document: "query Q { cart { id } }" }, {}, {});
    expect(sentBody(doFetch).query).toBe("query Q { cart { id } }");
    expect(sentBody(doFetch).extensions).toBeUndefined();
  });
});

describe("createPersistedResolver (server allowlist)", () => {
  const operations = {
    GetProduct: { document: OP.document, hash: OP.hash },
    NoHashOp: { document: "query NoHashOp { cart { id } }" },
  };
  const resolve = createPersistedResolver(operations);

  it("resolves a known hash to its document", () => {
    expect(resolve({ extensions: { persistedQuery: { version: 1, sha256Hash: OP.hash } } })).toEqual({
      kind: "ok",
      document: OP.document,
    });
  });

  it("answers not-found for an unknown hash with no document (APQ retry signal)", () => {
    expect(resolve({ extensions: { persistedQuery: { sha256Hash: "f".repeat(64) } } })).toEqual({
      kind: "not-found",
    });
  });

  it("accepts an APQ register retry only when the document is allowlisted", () => {
    const ext = { persistedQuery: { sha256Hash: "f".repeat(64) } };
    expect(resolve({ query: OP.document, extensions: ext })).toEqual({ kind: "ok", document: OP.document });
    expect(resolve({ query: "query Evil { secrets }", extensions: ext })).toEqual({ kind: "rejected" });
  });

  it("accepts an allowlisted plain query, rejects a free-form one", () => {
    expect(resolve({ query: operations.NoHashOp.document })).toEqual({
      kind: "ok",
      document: operations.NoHashOp.document,
    });
    expect(resolve({ query: "query Evil { secrets }" })).toEqual({ kind: "rejected" });
    expect(resolve({})).toEqual({ kind: "rejected" });
  });

  it("allowUnpersisted executes free-form queries (hash-as-compression mode)", () => {
    const lax = createPersistedResolver(operations, { allowUnpersisted: true });
    expect(lax({ query: "query Adhoc { cart { id } }" })).toEqual({ kind: "ok", document: "query Adhoc { cart { id } }" });
  });
});
