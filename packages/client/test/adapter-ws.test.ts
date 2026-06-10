import { describe, it, expect, vi } from "vitest";
import {
  createGraphWsAdapter,
  type GraphWsClient,
  type GraphWsPayload,
  type GraphWsSink,
  type GraphOperation,
} from "../src/index.js";

/**
 * A controllable fake of a `graphql-ws` client: it records each subscribe call and
 * exposes the sink so a test can drive `next`/`error`/`complete` and assert disposal.
 * No real WebSocket — the adapter is pure transport glue over this contract.
 */
function fakeClient() {
  const calls: Array<{
    payload: GraphWsPayload;
    sink: GraphWsSink<unknown>;
    dispose: ReturnType<typeof vi.fn>;
    disposed: () => boolean;
  }> = [];
  const client: GraphWsClient = {
    subscribe(payload, sink) {
      let isDisposed = false;
      const dispose = vi.fn(() => {
        isDisposed = true;
      });
      calls.push({ payload, sink: sink as GraphWsSink<unknown>, dispose, disposed: () => isDisposed });
      return dispose;
    },
  };
  return { client, calls, last: () => calls[calls.length - 1]! };
}

const QUERY: GraphOperation = { name: "GetProduct", kind: "query", document: "query GetProduct { product { id } }" };
const SUB: GraphOperation = { name: "OnTick", kind: "subscription", document: "subscription OnTick { tick }" };

describe("graphql-ws adapter: execute (query/mutation)", () => {
  it("resolves with the first result and disposes the subscription", async () => {
    const { client, last } = fakeClient();
    const adapter = createGraphWsAdapter({ client });

    const p = adapter.execute(QUERY, { handle: "x" }, {});
    last().sink.next({ data: { product: { id: "1" } } });
    last().sink.complete();

    expect(await p).toEqual({ data: { product: { id: "1" } } });
    expect(last().dispose).toHaveBeenCalledTimes(1);
  });

  it("forwards variables + operationName in the payload", async () => {
    const { client, last } = fakeClient();
    const adapter = createGraphWsAdapter({ client });
    void adapter.execute(QUERY, { handle: "cool-shirt" }, {});
    expect(last().payload).toMatchObject({
      query: QUERY.document,
      operationName: "GetProduct",
      variables: { handle: "cool-shirt" },
    });
  });

  it("maps an error into a GraphResult.errors and settles once", async () => {
    const { client, last } = fakeClient();
    const adapter = createGraphWsAdapter({ client });
    const p = adapter.execute(QUERY, {}, {});
    last().sink.error([{ message: "boom" }]);
    last().sink.next({ data: { ignored: true } }); // after settle — ignored
    expect(await p).toEqual({ errors: [{ message: "boom" }] });
  });

  it("resolves empty when the server completes without a result", async () => {
    const { client, last } = fakeClient();
    const adapter = createGraphWsAdapter({ client });
    const p = adapter.execute(QUERY, {}, {});
    last().sink.complete();
    expect(await p).toEqual({});
  });

  it("attaches context-derived extensions when provided", () => {
    const { client, last } = fakeClient();
    const adapter = createGraphWsAdapter({
      client,
      extensions: (ctx) => ({ token: (ctx as { token?: string }).token }),
    });
    void adapter.execute(QUERY, {}, { token: "secret" });
    expect(last().payload.extensions).toEqual({ token: "secret" });
  });
});

describe("graphql-ws adapter: subscribe (stream)", () => {
  it("bridges pushed results into an async iterable, in order", async () => {
    const { client, last } = fakeClient();
    const adapter = createGraphWsAdapter({ client });
    const it = adapter.subscribe!(SUB, {}, {})[Symbol.asyncIterator]();

    // Push before pull (queued) and pull-before-push (awaited) both work.
    last().sink.next({ data: { tick: 1 } });
    expect(await it.next()).toEqual({ value: { data: { tick: 1 } }, done: false });

    const pending = it.next();
    last().sink.next({ data: { tick: 2 } });
    expect(await pending).toEqual({ value: { data: { tick: 2 } }, done: false });
  });

  it("completes the iterable when the server completes", async () => {
    const { client, last } = fakeClient();
    const adapter = createGraphWsAdapter({ client });
    const it = adapter.subscribe!(SUB, {}, {})[Symbol.asyncIterator]();
    const pending = it.next();
    last().sink.complete();
    expect(await pending).toEqual({ value: undefined, done: true });
  });

  it("return() disposes the graphql-ws subscription and ends the stream", async () => {
    const { client, last } = fakeClient();
    const adapter = createGraphWsAdapter({ client });
    const it = adapter.subscribe!(SUB, {}, {})[Symbol.asyncIterator]();
    expect(await it.return!()).toEqual({ value: undefined, done: true });
    expect(last().dispose).toHaveBeenCalledTimes(1);
    expect(last().disposed()).toBe(true);
  });

  it("surfaces a socket error as a terminal errors frame", async () => {
    const { client, last } = fakeClient();
    const adapter = createGraphWsAdapter({ client });
    const it = adapter.subscribe!(SUB, {}, {})[Symbol.asyncIterator]();
    const pending = it.next();
    last().sink.error(new Error("socket dropped"));
    expect(await pending).toEqual({ value: { errors: [{ message: "socket dropped" }] }, done: false });
    expect(await it.next()).toEqual({ value: undefined, done: true });
  });
});
