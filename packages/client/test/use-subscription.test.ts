import { describe, it, expect, vi } from "vitest";
import {
  GraphRuntime,
  type GraphClientAdapter,
  type GraphRef,
  type GraphResult,
  type CompiledOperation,
} from "../src/index.js";
import { runBoundSubscription } from "../src/glue-client.js";

const PRODUCT: GraphRef = { __typename: "Product", id: "gid://shopify/Product/1" };

function makeRuntime() {
  return new GraphRuntime({
    fetchMissing: async (misses) => misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: undefined })),
  });
}

/** An adapter whose `subscribe` replays `frames` as an async stream, then ends. */
function streamAdapter(frames: ReadonlyArray<GraphResult<unknown>>): GraphClientAdapter {
  return {
    execute: async () => ({ data: {} }) as never,
    subscribe() {
      let i = 0;
      return {
        [Symbol.asyncIterator]() {
          return {
            next: async () =>
              i < frames.length
                ? { value: frames[i++]!, done: false }
                : { value: undefined as never, done: true },
            return: async () => ({ value: undefined as never, done: true }),
          };
        },
      } as never;
    },
  } as GraphClientAdapter;
}

function subscriptionOp(): Record<string, CompiledOperation> {
  return {
    Live_productChanged: {
      name: "Live_productChanged",
      kind: "subscription",
      document: "subscription Live_productChanged($handle: String!) { productChanged(handle: $handle) { __typename id title } }",
      hash: "h",
      variables: (ctx: unknown) => ctx as Record<string, unknown>,
      readMap: {},
    } as unknown as CompiledOperation,
  };
}

const product = (title: string) => ({ productChanged: { __typename: "Product", id: PRODUCT.id, title } });

describe("runBoundSubscription", () => {
  it("folds each pushed frame into the cache and calls onData; the entity updates in place", async () => {
    const runtime = makeRuntime();
    runtime.seed(PRODUCT, { title: "initial" });

    const seen: string[] = [];
    const onData = vi.fn(() => seen.push(runtime.readField(PRODUCT, "title") as string));

    const stop = runBoundSubscription({
      opName: "Live_productChanged",
      vars: { handle: "cool-shirt" },
      operations: subscriptionOp(),
      adapter: streamAdapter([{ data: product("live-1") }, { data: product("live-2") }]),
      runtime,
      context: {},
      onData,
    });

    await vi.waitFor(() => expect(onData).toHaveBeenCalledTimes(2));
    expect(seen).toEqual(["live-1", "live-2"]);
    expect(runtime.readField(PRODUCT, "title")).toBe("live-2"); // normalized in place
    stop();
  });

  it("surfaces an error frame via onError without stopping the stream", async () => {
    const runtime = makeRuntime();
    runtime.seed(PRODUCT, { title: "initial" });
    const onError = vi.fn();
    const onData = vi.fn();

    runBoundSubscription({
      opName: "Live_productChanged",
      vars: { handle: "x" },
      operations: subscriptionOp(),
      adapter: streamAdapter([{ errors: [{ message: "boom" }] }, { data: product("after-error") }]),
      runtime,
      context: {},
      onData,
      onError,
    });

    await vi.waitFor(() => expect(onData).toHaveBeenCalledTimes(1));
    expect(onError).toHaveBeenCalledWith("boom");
    expect(runtime.readField(PRODUCT, "title")).toBe("after-error");
  });

  it("stop() ends the stream and reports a clear error for an unknown / non-subscription op", () => {
    const runtime = makeRuntime();
    const onError = vi.fn();
    const stop = runBoundSubscription({
      opName: "Nope",
      vars: {},
      operations: subscriptionOp(),
      adapter: streamAdapter([]),
      runtime,
      context: {},
      onError,
    });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("unknown subscription operation"));
    expect(typeof stop).toBe("function");
    stop(); // idempotent / safe
  });

  it("errors when the adapter has no subscribe seam", () => {
    const runtime = makeRuntime();
    const onError = vi.fn();
    runBoundSubscription({
      opName: "Live_productChanged",
      vars: {},
      operations: subscriptionOp(),
      adapter: { execute: async () => ({ data: {} }) } as GraphClientAdapter,
      runtime,
      context: {},
      onError,
    });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("does not support subscriptions"));
  });
});
