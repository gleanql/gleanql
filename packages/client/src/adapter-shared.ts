import type { GraphResult } from "./adapter.js";

/**
 * Shared helpers for client adapters.
 *
 * Every adapter implements the same `GraphClientAdapter.execute` contract; the
 * runtime owns cache identity and Suspense, so an adapter is *only* transport.
 * These helpers keep error/response mapping consistent across clients.
 */

export interface GraphQLError {
  readonly message: string;
}

/** Build a `GraphResult`, omitting empty `data`/`errors` keys. */
export function result<TData>(data: TData | null | undefined, errors?: readonly GraphQLError[]): GraphResult<TData> {
  return {
    ...(data != null ? { data } : {}),
    ...(errors && errors.length > 0 ? { errors } : {}),
  };
}

/** A push→pull async iterator: the transport pushes, the consumer pulls. */
export interface PushPullIterator<T> extends AsyncIterator<T> {
  /** Deliver the next value to the consumer (ignored once finished). */
  push(value: T): void;
  /** End the stream; the consumer's next pull resolves `{ done: true }`. */
  finish(): void;
}

/**
 * Bridge a push-based transport (SSE `onmessage`, a graphql-ws sink) into the
 * pull-based `AsyncIterator` the runtime consumes. The transport wires its callbacks
 * to `push`/`finish`; the consumer's `return()` (cleanup) calls `onReturn` to tear the
 * transport down. Values pushed with no pending pull queue up and drain in order.
 */
export function pushPullIterator<T>(onReturn?: () => void): PushPullIterator<T> {
  const queue: T[] = [];
  let waiting: ((r: IteratorResult<T>) => void) | null = null;
  let done = false;
  const ended = (): IteratorResult<T> => ({ value: undefined, done: true });

  const finish = (): void => {
    if (done) return;
    done = true;
    if (waiting) {
      waiting(ended());
      waiting = null;
    }
  };

  return {
    push(value: T): void {
      if (done) return;
      if (waiting) {
        waiting({ value, done: false });
        waiting = null;
      } else {
        queue.push(value);
      }
    },
    finish,
    next(): Promise<IteratorResult<T>> {
      if (queue.length > 0) return Promise.resolve({ value: queue.shift()!, done: false });
      if (done) return Promise.resolve(ended());
      return new Promise((resolve) => {
        waiting = resolve;
      });
    },
    return(): Promise<IteratorResult<T>> {
      onReturn?.();
      finish();
      return Promise.resolve(ended());
    },
  };
}
