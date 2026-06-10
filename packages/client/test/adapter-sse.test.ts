import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createFetchAdapter, type GraphOperation } from "../src/index.js";

/**
 * SSE subscription transport — NEGATIVE paths. The happy "no EventSource on the
 * server" case lives in adapter-fetch.test.ts; here a fake `EventSource` global
 * lets a test drive `onmessage`/`onerror` directly and assert the stream's
 * resilience: a malformed frame is dropped, a transport error becomes a frame
 * (SSE auto-reconnects, so the stream must stay OPEN — unlike graphql-ws).
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static last(): FakeEventSource {
    return FakeEventSource.instances[FakeEventSource.instances.length - 1]!;
  }
  readonly url: string;
  closed = false;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close(): void {
    this.closed = true;
  }
}

const SUB: GraphOperation = { name: "OnTick", kind: "subscription", document: "subscription OnTick { tick }" };

function subscribe() {
  const adapter = createFetchAdapter({ endpoint: "/graphql", fetch: vi.fn() as unknown as typeof fetch });
  const it = adapter.subscribe!(SUB, {}, {})[Symbol.asyncIterator]();
  return { it, es: FakeEventSource.last() };
}

describe("fetch adapter: subscribe (SSE) negative paths", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("ignores a malformed data: frame and continues with the next good one", async () => {
    const { it: iterator, es } = subscribe();
    // A proxy hiccup / partial flush is not JSON — it must be dropped, not
    // crash the onmessage handler or poison the queue.
    es.onmessage!({ data: "this is not JSON {" });
    es.onmessage!({ data: JSON.stringify({ data: { tick: 1 } }) });
    expect(await iterator.next()).toEqual({ value: { data: { tick: 1 } }, done: false });
  });

  it("surfaces onerror as an errors frame while the stream stays open", async () => {
    const { it: iterator, es } = subscribe();
    es.onerror!();
    expect(await iterator.next()).toEqual({
      value: { errors: [{ message: "subscription stream error" }] },
      done: false,
    });
    // NOT terminal: EventSource auto-reconnects, so a later frame still arrives.
    es.onmessage!({ data: JSON.stringify({ data: { tick: 2 } }) });
    expect(await iterator.next()).toEqual({ value: { data: { tick: 2 } }, done: false });
    expect(es.closed).toBe(false);
  });

  it("return() closes the EventSource and ends the stream", async () => {
    const { it: iterator, es } = subscribe();
    expect(await iterator.return!()).toEqual({ value: undefined, done: true });
    expect(es.closed).toBe(true);
    // Frames after teardown are ignored; the iterator stays done.
    es.onmessage!({ data: JSON.stringify({ data: { tick: 3 } }) });
    expect(await iterator.next()).toEqual({ value: undefined, done: true });
  });
});
