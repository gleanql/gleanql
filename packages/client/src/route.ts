import type { SelectionSet } from "@gleanql/core";
import type { GraphClientAdapter, GraphRequestContext } from "./adapter.js";
import type { GraphRuntime } from "./runtime.js";
import type { FieldValue } from "./cache.js";
import { persistRootLinks, resolveFromCache } from "./cache-resolve.js";

/**
 * Framework-integration seam. A compiled operation (the artifact the compiler
 * emits) plus a client adapter and a request context is enough to drive a
 * route: compute variables, execute, seed the cache. A framework adapter
 * (RWSDK first) answers "which operation for this entrypoint?" and "how do I
 * build the request context?".
 */
export interface CompiledOperation<RouteContext = unknown, TVariables = Record<string, unknown>> {
  readonly name: string;
  readonly kind: "query" | "mutation" | "subscription";
  readonly document: string;
  readonly hash?: string;
  readonly variables: (ctx: RouteContext) => TVariables;
  readonly readMap?: Record<string, readonly string[]>;
  /** Merged selection tree; enables cache-first resolution when present. */
  readonly selection?: SelectionSet;
}

export interface RunRouteOptions {
  /**
   * Cache-first: if the cache already satisfies the operation's full selection,
   * skip the network. Defaults to true; pass false to always fetch (e.g. an
   * explicit refresh that must hit the server).
   */
  readonly cacheFirst?: boolean;
}

export interface RunRouteResult<TVariables> {
  readonly variables: TVariables;
  readonly roots: Record<string, FieldValue>;
  readonly errors?: ReadonlyArray<{ message: string }>;
}

/** Execute a compiled operation and seed the runtime cache (steps 2–5 of the route flow). */
export async function runRoute<RouteContext, TVariables extends Record<string, unknown>>(args: {
  operation: CompiledOperation<RouteContext, TVariables>;
  routeContext: RouteContext;
  adapter: GraphClientAdapter;
  context: GraphRequestContext;
  runtime: GraphRuntime;
  options?: RunRouteOptions;
}): Promise<RunRouteResult<TVariables>> {
  const variables = args.operation.variables(args.routeContext);
  const selection = args.operation.selection;
  const cacheFirst = args.options?.cacheFirst ?? true;

  // Cache-first: serve from the normalized cache when it already covers the op.
  if (cacheFirst && selection) {
    const hit = resolveFromCache(args.runtime.cache, selection, variables);
    if (hit.covered) return { variables, roots: hit.roots };
  }

  const result = await args.adapter.execute(
    { name: args.operation.name, kind: args.operation.kind, document: args.operation.document },
    variables,
    args.context,
  );
  const roots = result.data ? args.runtime.seedResult(result.data as Record<string, unknown>) : {};
  // Persist root links so a later run can resolve this operation from cache.
  if (selection && result.data) persistRootLinks(args.runtime.cache, selection, variables, roots);
  return { variables, roots, errors: result.errors };
}

/**
 * Re-run an operation against the network, bypassing cache-first, and re-seed.
 * The re-seed writes through the cache, bumping its version and notifying
 * subscribers — so a `useSyncExternalStore` (`cache.subscribe`) re-renders the
 * UI with the fresh data. Use for an explicit "Refresh" / post-mutation refetch.
 */
export function refetch<RouteContext, TVariables extends Record<string, unknown>>(args: {
  operation: CompiledOperation<RouteContext, TVariables>;
  routeContext: RouteContext;
  adapter: GraphClientAdapter;
  context: GraphRequestContext;
  runtime: GraphRuntime;
}): Promise<RunRouteResult<TVariables>> {
  return runRoute({ ...args, options: { cacheFirst: false } });
}
