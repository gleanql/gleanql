/**
 * Client adapter interface. The graph runtime owns cache identity, Suspense,
 * batching and normalization; an adapter owns transport (HTTP, auth, retries).
 * Ships a plain fetch adapter; any transport (graphql-ws for subscriptions, or a
 * urql/Apollo client if an app already runs one) slots in behind this interface.
 */
import { pushPullIterator } from "./adapter-shared.js";

export interface GraphOperation<_TData = unknown, _TVariables = unknown> {
  readonly name: string;
  readonly kind: "query" | "mutation" | "subscription";
  readonly document: string;
  /** SHA-256 hex of `document` — the persisted-operation ID (present on compiled operations). */
  readonly hash?: string;
}

export interface GraphRequestContext {
  readonly [key: string]: unknown;
}

export interface GraphResult<TData> {
  readonly data?: TData;
  readonly errors?: ReadonlyArray<{ message: string }>;
}

export interface GraphClientAdapter {
  execute<TData, TVariables>(
    operation: GraphOperation<TData, TVariables>,
    variables: TVariables,
    context: GraphRequestContext,
  ): Promise<GraphResult<TData>>;

  subscribe?<TData, TVariables>(
    operation: GraphOperation<TData, TVariables>,
    variables: TVariables,
    context: GraphRequestContext,
  ): AsyncIterable<GraphResult<TData>>;
}

export interface FetchAdapterOptions {
  readonly endpoint: string;
  readonly fetch?: typeof fetch;
  /** Build request headers from context (auth, shop domain, locale, ...). */
  readonly headers?: (context: GraphRequestContext) => Record<string, string>;
  /**
   * Endpoint for subscriptions, consumed as a Server-Sent Events stream via the
   * browser's `EventSource`. Defaults to `${endpoint}/stream`. A production app
   * that prefers WebSockets can drop a `graphql-ws` adapter into the same
   * `subscribe` seam instead.
   */
  readonly subscriptionEndpoint?: string;
  /**
   * Send operations BY HASH instead of by document (`extensions.persistedQuery.
   * sha256Hash` — the Apollo APQ wire shape, which `createPersistedResolver`
   * understands server-side). The document never rides the request, so the
   * server can enforce a build-produced allowlist. If the server answers
   * `PersistedQueryNotFound` (e.g. an APQ cache that hasn't seen the hash), the
   * request retries ONCE with the full document so the server can register it.
   * Operations without a `hash` fall back to sending the document.
   */
  readonly persisted?: boolean;
  /** Observability hook: a persisted hash was unknown to the server and the document was re-sent (APQ register). */
  readonly onPersistedRetry?: (operationName: string) => void;
}

/** Minimal fetch transport. Context is used only to build headers; it is never serialized into the body. */
export function createFetchAdapter(options: FetchAdapterOptions): GraphClientAdapter {
  const doFetch = options.fetch ?? fetch;
  return {
    async execute<TData, TVariables>(
      operation: GraphOperation<TData, TVariables>,
      variables: TVariables,
      context: GraphRequestContext,
    ): Promise<GraphResult<TData>> {
      const post = async (body: Record<string, unknown>): Promise<GraphResult<TData>> => {
        const res = await doFetch(options.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.headers ? options.headers(context) : {}),
          },
          body: JSON.stringify(body),
        });
        // A GraphQL response (even an error one) is JSON; anything else (proxy 502
        // HTML, empty body) becomes a clear transport error instead of a parse error.
        const parsed = (await res.json().catch(() => undefined)) as GraphResult<TData> | undefined;
        if (parsed === undefined) {
          throw new Error(`graph fetch: non-JSON response (${res.status} ${res.statusText}) from ${options.endpoint}`);
        }
        return parsed;
      };

      if (options.persisted && operation.hash) {
        const extensions = { persistedQuery: { version: 1, sha256Hash: operation.hash } };
        const first = await post({ operationName: operation.name, variables, extensions });
        // APQ negotiation: an allowlist server never answers this (the build seeded
        // it); a cache-style server asks for the document once.
        if (first.errors?.some((e) => e.message === "PersistedQueryNotFound")) {
          options.onPersistedRetry?.(operation.name);
          return post({ query: operation.document, operationName: operation.name, variables, extensions });
        }
        return first;
      }

      return post({ query: operation.document, variables, operationName: operation.name });
    },

    // Subscriptions ride an SSE stream (GET + EventSource) — client-only. The
    // operation rides the query string; each `data:` frame is a GraphResult JSON.
    subscribe<TData, TVariables>(
      operation: GraphOperation<TData, TVariables>,
      variables: TVariables,
    ): AsyncIterable<GraphResult<TData>> {
      const base = options.subscriptionEndpoint ?? `${options.endpoint}/stream`;
      return sseIterable(base, operation.document, variables, operation.name) as AsyncIterable<GraphResult<TData>>;
    },
  };
}

/** Bridge a Server-Sent Events stream into an `AsyncIterable<GraphResult>`. */
function sseIterable(
  url: string,
  document: string,
  variables: unknown,
  operationName: string,
): AsyncIterable<GraphResult<unknown>> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<GraphResult<unknown>> {
      // No EventSource (server / non-browser): an empty, immediately-done stream.
      if (typeof EventSource === "undefined") {
        return { next: () => Promise.resolve({ value: undefined, done: true }) };
      }
      const qs =
        `query=${encodeURIComponent(document)}` +
        `&operationName=${encodeURIComponent(operationName)}` +
        `&variables=${encodeURIComponent(JSON.stringify(variables ?? {}))}`;
      const es = new EventSource(`${url}?${qs}`);
      const it = pushPullIterator<GraphResult<unknown>>(() => es.close());

      es.onmessage = (e: MessageEvent) => {
        try {
          it.push(JSON.parse(e.data) as GraphResult<unknown>);
        } catch {
          /* ignore malformed frame */
        }
      };
      // SSE auto-reconnects, so surface the error as a frame but keep the stream open.
      es.onerror = () => it.push({ errors: [{ message: "subscription stream error" }] });
      return it;
    },
  };
}
