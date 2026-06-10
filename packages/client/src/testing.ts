import type { SchemaModel } from "@gleanql/core";
import { GraphRuntime } from "./runtime.js";
import { bindGraph, type BoundGraph } from "./proxy.js";
import type { FieldValue } from "./cache.js";
import type { GraphHydrationPayload } from "./serialize.js";
import type { GraphClientAdapter, GraphOperation, GraphRequestContext, GraphResult } from "./adapter.js";

/**
 * The consumer-facing test harness. An app imports this through the generated
 * `@gleanql/client/testing` entrypoint (which bakes the schema in), so a test
 * seeds a real runtime from plain JSON and reads through real graph proxies —
 * no GraphQL server, no compiled operations, no Vite.
 *
 * Three pieces:
 * - {@link buildTestGraph}: plain data → a seeded runtime + bound `glean` +
 *   a hydration payload that rides the production hydration path
 *   (`<GraphHydrator payload={…}>` in RSC, `hydrate(payload)` isomorphic).
 * - {@link createMockAdapter}: a recording adapter with canned responses per
 *   operation name — for `runRoute`/`runMutation`/integration-level tests.
 * - {@link mockGraphFetch}: intercepts the generated client's `fetch` to the
 *   graph endpoint — for `useMutation`/`refresh` island tests in jsdom.
 */

export interface TestGraphOptions {
  readonly schema: SchemaModel;
  /**
   * Operation-shaped result JSON: root fields at the top, `__typename` on every
   * object (and `id` where the type has one) so records normalize by identity.
   */
  readonly data: Record<string, unknown>;
  /** Label for the page pointer (defaults to `"TestGraph"`). */
  readonly operationName?: string;
  readonly variables?: Record<string, unknown>;
  /** Client-safe request context (locale etc.) the page would have carried. */
  readonly context?: Record<string, unknown>;
  /**
   * What a read of an UNSEEDED field does. `"error"` (default) rejects with a
   * message naming the fields — a test should seed everything it renders.
   * `"undefined"` resolves the miss to `undefined`, like the generated client.
   */
  readonly onMiss?: "error" | "undefined";
}

export interface TestGraph {
  /** A bound graph: `glean.product({ handle }).title` reads like app code. */
  readonly glean: BoundGraph;
  readonly runtime: GraphRuntime;
  readonly roots: Record<string, FieldValue>;
  /**
   * A real {@link GraphHydrationPayload} carrying the seeded records — feed it
   * to the generated client's `<GraphHydrator payload={…}>` (RSC) or
   * `hydrate(payload)` (isomorphic) and `useGlean()` reads warm in jsdom.
   */
  readonly payload: GraphHydrationPayload;
}

/** Seed a real runtime from plain operation-shaped JSON and bind a graph over it. */
export function buildTestGraph(options: TestGraphOptions): TestGraph {
  const { schema, data, operationName = "TestGraph", variables = {}, context = {}, onMiss = "error" } = options;
  const runtime = new GraphRuntime({
    keyOf: (typename, obj) => schema.identityOf(typename, obj),
    fetchMissing: async (misses) => {
      if (onMiss === "error") {
        const fields = misses.map((m) => m.fieldKey).join(", ");
        throw new Error(`test graph: read of unseeded field(s): ${fields} — seed them in createTestGraph({ data })`);
      }
      return misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: undefined }));
    },
  });
  const roots = runtime.seedResult(data);
  const glean = bindGraph({ schema, getRuntime: () => runtime, roots });
  return {
    glean,
    runtime,
    roots,
    payload: { operationName, variables, snapshot: runtime.snapshot(), roots, context },
  };
}

/** What a {@link createMockAdapter} handler may return: the operation's data, or a full result. */
export type MockResponder =
  | unknown
  | ((variables: Record<string, unknown>) => unknown | Promise<unknown>);

export interface MockAdapterCall {
  readonly name: string;
  readonly kind: "query" | "mutation" | "subscription";
  readonly variables: Record<string, unknown>;
}

export interface MockAdapter extends GraphClientAdapter {
  /** Every operation the adapter saw, in order. */
  readonly calls: readonly MockAdapterCall[];
  /** Push a payload to every live subscription of `operationName`. */
  push(operationName: string, data: unknown): void;
  /** Complete every live subscription of `operationName`. */
  end(operationName: string): void;
}

/** A handler's return value becomes `{ data }` unless it already carries an `errors` array. */
function toResult<TData>(value: unknown): GraphResult<TData> {
  if (value && typeof value === "object" && Array.isArray((value as { errors?: unknown }).errors)) {
    return value as GraphResult<TData>;
  }
  return { data: value as TData };
}

/**
 * A recording adapter with canned responses per operation name. Handlers return
 * the operation's DATA (or a `{ data?, errors }` result, or a function of the
 * variables). Subscriptions are push-driven: `adapter.push(name, data)`.
 */
export function createMockAdapter(handlers: Record<string, MockResponder> = {}): MockAdapter {
  const calls: MockAdapterCall[] = [];
  const streams = new Map<string, Set<(result: GraphResult<unknown> | null) => void>>();

  const respond = async (operation: GraphOperation, variables: unknown): Promise<GraphResult<unknown>> => {
    const handler = handlers[operation.name];
    if (handler === undefined) return { errors: [{ message: `mock adapter: no handler for "${operation.name}"` }] };
    const value = typeof handler === "function" ? await (handler as Function)(variables) : handler;
    return toResult(value);
  };

  return {
    calls,
    async execute<TData, TVariables>(
      operation: GraphOperation<TData, TVariables>,
      variables: TVariables,
      _context: GraphRequestContext,
    ): Promise<GraphResult<TData>> {
      calls.push({ name: operation.name, kind: operation.kind, variables: (variables ?? {}) as Record<string, unknown> });
      return (await respond(operation, variables)) as GraphResult<TData>;
    },
    subscribe<TData, TVariables>(
      operation: GraphOperation<TData, TVariables>,
      variables: TVariables,
      _context: GraphRequestContext,
    ): AsyncIterable<GraphResult<TData>> {
      calls.push({ name: operation.name, kind: operation.kind, variables: (variables ?? {}) as Record<string, unknown> });
      const listeners = streams.get(operation.name) ?? new Set();
      streams.set(operation.name, listeners);
      return {
        [Symbol.asyncIterator]() {
          const queue: Array<GraphResult<unknown> | null> = [];
          let wake: (() => void) | undefined;
          const listener = (result: GraphResult<unknown> | null) => {
            queue.push(result);
            wake?.();
          };
          listeners.add(listener);
          return {
            async next(): Promise<IteratorResult<GraphResult<TData>>> {
              while (queue.length === 0) await new Promise<void>((r) => (wake = r));
              const value = queue.shift()!;
              if (value === null) {
                listeners.delete(listener);
                return { done: true, value: undefined };
              }
              return { done: false, value: value as GraphResult<TData> };
            },
            async return(): Promise<IteratorResult<GraphResult<TData>>> {
              listeners.delete(listener);
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
    push(operationName: string, data: unknown): void {
      for (const listener of streams.get(operationName) ?? []) listener(toResult(data));
    },
    end(operationName: string): void {
      for (const listener of streams.get(operationName) ?? []) listener(null);
    },
  };
}

export interface MockGraphFetch {
  /** Every graph request the endpoint saw, in order. */
  readonly calls: readonly MockAdapterCall[];
  /** Put the original `fetch` back. */
  restore(): void;
}

/**
 * Intercept the generated client's `fetch` to the graph endpoint, answering by
 * `operationName` — so a jsdom test of a `useMutation`/`refresh` island needs no
 * server and no adapter seam. Non-graph requests fall through to the real fetch.
 */
export function mockGraphFetch(
  handlers: Record<string, MockResponder>,
  options: { readonly endpoint?: string } = {},
): MockGraphFetch {
  const endpoint = options.endpoint ?? "/graphql";
  const calls: MockAdapterCall[] = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const isGraph = url === endpoint || url.split("?")[0]!.endsWith(endpoint);
    if (!isGraph || (init?.method ?? "GET").toUpperCase() !== "POST") {
      return original(input as RequestInfo, init);
    }
    const body = JSON.parse(String(init?.body ?? "{}")) as {
      operationName?: string;
      variables?: Record<string, unknown>;
    };
    const name = body.operationName ?? "(anonymous)";
    const variables = body.variables ?? {};
    calls.push({ name, kind: "query", variables });
    const handler = handlers[name];
    const result =
      handler === undefined
        ? { errors: [{ message: `mockGraphFetch: no handler for "${name}"` }] }
        : toResult(typeof handler === "function" ? await (handler as Function)(variables) : handler);
    return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  }) as typeof fetch;

  return { calls, restore: () => void (globalThis.fetch = original) };
}
