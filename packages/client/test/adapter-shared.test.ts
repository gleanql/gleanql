import { describe, it, expect, vi } from "vitest";
import { pushPullIterator } from "../src/index.js";

/**
 * The push→pull bridge every streaming adapter (SSE, graphql-ws) is built on.
 * The adapter tests cover it end-to-end through their transports; these pin the
 * primitive's own contract: buffering order, post-finish behavior, teardown.
 */
describe("pushPullIterator", () => {
  it("queues values pushed before any pull and drains them in order", async () => {
    const iter = pushPullIterator<number>();
    // Transport outruns the consumer: three pushes with no pending pull.
    iter.push(1);
    iter.push(2);
    iter.push(3);
    expect(await iter.next()).toEqual({ value: 1, done: false });
    expect(await iter.next()).toEqual({ value: 2, done: false });
    expect(await iter.next()).toEqual({ value: 3, done: false });
    // Queue drained: the next pull parks until a later push resolves it.
    const pending = iter.next();
    iter.push(4);
    expect(await pending).toEqual({ value: 4, done: false });
  });

  it("drains the buffered queue before ending, and ignores pushes after finish", async () => {
    const iter = pushPullIterator<string>();
    iter.push("buffered");
    iter.finish();
    iter.push("late"); // after finish — must be dropped, not queued
    // The pre-finish value still reaches the consumer; then the stream ends.
    expect(await iter.next()).toEqual({ value: "buffered", done: false });
    expect(await iter.next()).toEqual({ value: undefined, done: true });
    expect(await iter.next()).toEqual({ value: undefined, done: true });
  });

  it("resolves a parked pull with done when finish() arrives first", async () => {
    const iter = pushPullIterator<number>();
    const pending = iter.next(); // consumer waiting, nothing buffered
    iter.finish();
    expect(await pending).toEqual({ value: undefined, done: true });
  });

  it("return() calls onReturn exactly once and ends the stream", async () => {
    const onReturn = vi.fn();
    const iter = pushPullIterator<number>(onReturn);
    expect(await iter.return!()).toEqual({ value: undefined, done: true });
    expect(onReturn).toHaveBeenCalledTimes(1);
    // The stream is torn down: pushes are ignored and pulls stay done.
    iter.push(99);
    expect(await iter.next()).toEqual({ value: undefined, done: true });
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});
