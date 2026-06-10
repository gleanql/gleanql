import {
  GraphRuntime,
  bindGraph,
  createMutator,
  invalidateValue,
  runRoute,
  type BoundGraph,
  type BoundMutations,
  type CompiledOperation,
  type FieldValue,
  type GraphClientAdapter,
  type GraphRef,
  type GraphRequestContext,
  type GraphScope,
  type MissingFieldMode,
  type MissingFieldRead,
  type MissingFieldResult,
} from "./index.js";
import type { SchemaModel } from "@gleanql/core";
import { buildRouteContext, type BuildRouteContextOptions, type GraphRouteContext, type RequestInfo } from "./context.js";

/**
 * RedwoodSDK integration.
 *
 * Answers the four questions the brief asks of a framework adapter:
 *  - Which operation drives this entrypoint?  -> `resolveOperationName` / explicit name
 *  - How do we read params/search/request/env? -> `buildRouteContext`
 *  - How do we preload + seed?                 -> `runRoute` into a fresh per-request cache
 *  - How do we expose the graph to components? -> attach a bound graph to `ctx`
 *
 * Per request: pick the operation, compute variables, execute via the client
 * adapter, seed a fresh cache, and attach `{ runtime, graph, ... }` to
 * `requestInfo.ctx` so Pages/components read graph fields with cache hits. Unseeded
 * (lazy) fields fall through to the Suspense runtime.
 */

const CTX_KEY = "__graph" as const;

export interface ActiveRequestGraph extends GraphRequestContext {
  readonly runtime: GraphRuntime;
  readonly graph: BoundGraph;
  /** `graph.mutate.*` — one callable per compiled mutation operation. */
  readonly mutate: BoundMutations;
  readonly roots: Record<string, FieldValue>;
  readonly operation: CompiledOperation<GraphRouteContext>;
  readonly variables: Record<string, unknown>;
  /** The route/request context (used for transport + missing-field fetches). */
  readonly requestContext: GraphRouteContext;
  readonly errors?: ReadonlyArray<{ message: string }>;
}

export interface GraphIntegrationOptions<Ctx extends Record<string, unknown> = Record<string, unknown>>
  extends BuildRouteContextOptions<Ctx> {
  readonly schema: SchemaModel;
  /** Compiled operations, keyed by name (e.g. from `virtual:graph/operations`). */
  readonly operations: Record<string, CompiledOperation<GraphRouteContext>>;
  /** Transport: a fetch/graphql-request adapter. */
  readonly adapter: GraphClientAdapter;
  /** Map a request to its operation name when `preload` is called without one. */
  readonly resolveOperationName?: (requestInfo: RequestInfo<Ctx>) => string | undefined;
  /**
   * Fetch fields absent from the compiled operation (lazy boundaries, dynamic
   * misses). Receives the batched misses + request context; returns resolved
   * values. If omitted, misses are allowed/warned per `unexpectedMissingField`
   * (hybrid mode) and resolve to `undefined`.
   */
  readonly fetchMissing?: (
    misses: readonly MissingFieldRead[],
    context: GraphRequestContext,
  ) => Promise<readonly MissingFieldResult[]>;
  readonly unexpectedMissingField?: MissingFieldMode;
  readonly onWarn?: (message: string) => void;
  /** Allow-list of `context` keys that are safe to serialize to the client. */
  readonly clientSafeContext?: readonly string[];
  /** Optional scope to make a module-level `graph` import resolve this runtime. */
  readonly scope?: GraphScope;
}

export interface GraphIntegration<Ctx extends Record<string, unknown>> {
  /** Preload + seed the operation for a request; attaches the graph to `ctx`. */
  preload(requestInfo: RequestInfo<Ctx>, operationName?: string): Promise<ActiveRequestGraph | undefined>;
  /** Read the active graph attached to a request (throws if not preloaded). */
  getGraph(requestInfo: RequestInfo<Ctx>): BoundGraph;
  /** The `graph.mutate.*` namespace for this request (throws if not preloaded). */
  getMutator(requestInfo: RequestInfo<Ctx>): BoundMutations;
  /** Invalidate a graph value / ref in this request's cache (refetch on next read). */
  invalidate(requestInfo: RequestInfo<Ctx>, value: GraphRef | unknown): void;
  /** Read the full active request state (runtime, roots, variables, ...). */
  getActive(requestInfo: RequestInfo<Ctx>): ActiveRequestGraph | undefined;
  /** Re-run the active (or named) operation, bypassing cache-first, into the same cache. */
  refetch(requestInfo: RequestInfo<Ctx>, operationName?: string): Promise<void>;
  /** Run `fn` with this request's runtime installed on the scope (server render). */
  runInScope<R>(requestInfo: RequestInfo<Ctx>, fn: () => R): R;
}

export function createGraphIntegration<Ctx extends Record<string, unknown> = Record<string, unknown>>(
  options: GraphIntegrationOptions<Ctx>,
): GraphIntegration<Ctx> {
  // Identify entities by the schema's key fields (default `id`, or a `keys`
  // override), so types keyed by something other than `id` normalize correctly.
  const keyOf = (typename: string, obj: Record<string, unknown>) => options.schema.identityOf(typename, obj);

  function makeRuntime(requestContext: GraphRouteContext): GraphRuntime {
    return new GraphRuntime({
      keyOf,
      unexpectedMissingField: options.unexpectedMissingField,
      onWarn: options.onWarn,
      fetchMissing: async (misses) =>
        options.fetchMissing ? options.fetchMissing(misses, requestContext) : missesUnresolved(misses),
    });
  }

  async function preload(
    requestInfo: RequestInfo<Ctx>,
    operationName?: string,
  ): Promise<ActiveRequestGraph | undefined> {
    const name = operationName ?? options.resolveOperationName?.(requestInfo);
    const operation = name ? options.operations[name] : undefined;
    if (!operation) return undefined; // not a graph-backed entrypoint

    const requestContext = buildRouteContext(requestInfo, options);
    const runtime = makeRuntime(requestContext);
    const { variables, roots, errors } = await runRoute({
      operation,
      routeContext: requestContext,
      adapter: options.adapter,
      context: requestContext,
      runtime,
    });
    const graph = bindGraph({ schema: options.schema, getRuntime: () => runtime, roots });
    const mutate = createMutator({ operations: options.operations, adapter: options.adapter, runtime, context: requestContext });

    const active: ActiveRequestGraph = {
      runtime,
      graph,
      mutate,
      roots,
      operation,
      variables,
      requestContext,
      ...(errors ? { errors } : {}),
    };
    (requestInfo.ctx as Record<string, unknown>)[CTX_KEY] = active;
    return active;
  }

  function getActive(requestInfo: RequestInfo<Ctx>): ActiveRequestGraph | undefined {
    return (requestInfo.ctx as Record<string, unknown>)[CTX_KEY] as ActiveRequestGraph | undefined;
  }

  async function refetch(requestInfo: RequestInfo<Ctx>, operationName?: string): Promise<void> {
    const active = getActive(requestInfo);
    if (!active) return;
    const operation = options.operations[operationName ?? active.operation.name];
    if (!operation) return;
    // Re-run into the same cache, bypassing cache-first; the re-seed bumps the
    // cache version so subscribers (useSyncExternalStore) re-render.
    await runRoute({
      operation,
      routeContext: active.requestContext,
      adapter: options.adapter,
      context: active.requestContext,
      runtime: active.runtime,
      options: { cacheFirst: false },
    });
  }

  function getGraph(requestInfo: RequestInfo<Ctx>): BoundGraph {
    const active = getActive(requestInfo);
    if (!active) {
      throw new Error(
        "No graph attached to this request. Call integration.preload(requestInfo) before rendering (e.g. in a middleware or at the top of the Page).",
      );
    }
    return active.graph;
  }

  function getMutator(requestInfo: RequestInfo<Ctx>): BoundMutations {
    const active = getActive(requestInfo);
    if (!active) throw new Error("No graph attached to this request. Call integration.preload(requestInfo) first.");
    return active.mutate;
  }

  function invalidate(requestInfo: RequestInfo<Ctx>, value: GraphRef | unknown): void {
    const active = getActive(requestInfo);
    if (active) invalidateValue(active.runtime, value);
  }

  function runInScope<R>(requestInfo: RequestInfo<Ctx>, fn: () => R): R {
    const active = getActive(requestInfo);
    if (!active || !options.scope) return fn();
    return options.scope.run({ runtime: active.runtime, graph: active.graph }, fn);
  }

  return { preload, getGraph, getMutator, invalidate, getActive, refetch, runInScope };
}

/** Default missing-field resolution: leave each miss undefined (hybrid allow/warn). */
function missesUnresolved(misses: readonly MissingFieldRead[]): readonly MissingFieldResult[] {
  return misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: undefined }));
}
