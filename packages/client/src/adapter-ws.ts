import type {
  GraphClientAdapter,
  GraphOperation,
  GraphRequestContext,
  GraphResult,
} from "./adapter.js";
import { pushPullIterator } from "./adapter-shared.js";

/**
 * A `graphql-ws` transport for the same `GraphClientAdapter` seam the fetch
 * adapter implements. WebSockets carry every operation kind — a query/mutation is
 * a single-result stream that completes, a subscription is a long-lived one — so
 * this adapter drives both `execute` and `subscribe` off one `graphql-ws` client.
 *
 * We do NOT bundle `graphql-ws`: the app installs it, calls its `createClient({ url })`,
 * and passes the result here. The client is typed structurally (the subset we use)
 * so the dependency stays optional and the adapter is trivially testable with a fake.
 *
 *   import { createClient } from "graphql-ws";
 *   const adapter = createGraphWsAdapter({ client: createClient({ url: "wss://…/graphql" }) });
 */

/** Sink graphql-ws pushes results into — mirrors its `Sink`. */
export interface GraphWsSink<T = unknown> {
  next: (value: T) => void;
  error: (error: unknown) => void;
  complete: () => void;
}

/** Operation payload graphql-ws subscribes with — mirrors its `SubscribePayload`. */
export interface GraphWsPayload {
  readonly query: string;
  readonly variables?: Record<string, unknown> | null;
  readonly operationName?: string | null;
  readonly extensions?: Record<string, unknown>;
}

/** Structural subset of graphql-ws's `Client` we depend on. */
export interface GraphWsClient {
  subscribe<T = GraphResult<unknown>>(payload: GraphWsPayload, sink: GraphWsSink<T>): () => void;
  dispose?: () => void | Promise<void>;
}

export interface GraphWsAdapterOptions {
  /** A graphql-ws client, e.g. `createClient({ url })`. */
  readonly client: GraphWsClient;
  /**
   * Per-request `extensions` from context (auth token, shop domain, locale). The
   * connection-level params belong on the client; this rides each operation.
   */
  readonly extensions?: (context: GraphRequestContext) => Record<string, unknown>;
}

function toErrors(error: unknown): ReadonlyArray<{ message: string }> {
  if (Array.isArray(error)) {
    return error.map((e) => ({ message: String((e as { message?: unknown })?.message ?? e) }));
  }
  if (error instanceof Error) return [{ message: error.message }];
  if (error && typeof error === "object" && "reason" in error) {
    // A WebSocket CloseEvent.
    return [{ message: String((error as { reason?: unknown }).reason) || "subscription socket closed" }];
  }
  return [{ message: String(error) }];
}

export function createGraphWsAdapter(options: GraphWsAdapterOptions): GraphClientAdapter {
  const { client } = options;

  const payloadFor = <TVariables>(
    operation: GraphOperation<unknown, TVariables>,
    variables: TVariables,
    context: GraphRequestContext,
  ): GraphWsPayload => {
    const extensions = options.extensions?.(context);
    return {
      query: operation.document,
      variables: (variables ?? {}) as Record<string, unknown>,
      operationName: operation.name,
      ...(extensions && Object.keys(extensions).length > 0 ? { extensions } : {}),
    };
  };

  return {
    // Query / mutation: take the single result, settle on the first `next` (or on
    // `complete`/`error` if the server completes empty). Dispose immediately after.
    execute<TData, TVariables>(
      operation: GraphOperation<TData, TVariables>,
      variables: TVariables,
      context: GraphRequestContext,
    ): Promise<GraphResult<TData>> {
      return new Promise<GraphResult<TData>>((resolve) => {
        let settled = false;
        let dispose: (() => void) | undefined;
        const settle = (r: GraphResult<TData>): void => {
          if (settled) return;
          settled = true;
          resolve(r);
          dispose?.();
        };
        dispose = client.subscribe(payloadFor(operation, variables, context), {
          next: (value) => settle(value as GraphResult<TData>),
          error: (error) => settle({ errors: toErrors(error) }),
          complete: () => settle({}),
        });
        // `subscribe` may have settled synchronously before `dispose` was assigned.
        if (settled) dispose?.();
      });
    },

    // Subscription: bridge the push-based sink into a pull-based AsyncIterable, the
    // shape the runtime consumes. `return()` disposes the graphql-ws subscription.
    subscribe<TData, TVariables>(
      operation: GraphOperation<TData, TVariables>,
      variables: TVariables,
      context: GraphRequestContext,
    ): AsyncIterable<GraphResult<TData>> {
      return {
        [Symbol.asyncIterator](): AsyncIterator<GraphResult<TData>> {
          let dispose: (() => void) | undefined;
          const it = pushPullIterator<GraphResult<TData>>(() => dispose?.());
          dispose = client.subscribe(payloadFor(operation, variables, context), {
            next: (value) => it.push(value as GraphResult<TData>),
            error: (error) => {
              it.push({ errors: toErrors(error) });
              it.finish();
            },
            complete: () => it.finish(),
          });
          return it;
        },
      };
    },
  };
}
