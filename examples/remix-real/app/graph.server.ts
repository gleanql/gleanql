import { AsyncLocalStorage } from "node:async_hooks";
import {
  createGraphIntegration,
  serializeGraph,
  operations,
  schema,
  type ActiveGraph,
  type ActiveRequestGraph,
  type GraphHydrationPayload,
} from "@gleanql/client";
import { scope } from "~/graph-scope";
import { makeGraphAdapter } from "@gleanql/storefront-fixture";

// SERVER-ONLY (`.server.ts`): the only place `node:async_hooks` is imported. The
// `.server` suffix keeps it out of the client bundle (the build fails if it leaks).
// Attach the ALS to the shared scope so concurrent requests stay isolated.
scope.attachAls(new AsyncLocalStorage<ActiveGraph>());

const integration = createGraphIntegration({ schema, operations, adapter: makeGraphAdapter() });

/**
 * Map a request URL to its operation + variables. The operation name equals the
 * route component's name (the compiler's convention), so `/products/:handle` drives
 * the `Product` operation, etc. Two graph routes ⇒ a tiny explicit table.
 */
function resolveRoute(url: string): { operationName: string; params: Record<string, string> } | undefined {
  const { pathname } = new URL(url);
  const product = /^\/products\/([^/]+)/.exec(pathname);
  if (product) return { operationName: "Product", params: { handle: product[1]! } };
  const collection = /^\/collections\/([^/]+)/.exec(pathname);
  if (collection) return { operationName: "Collection", params: { handle: collection[1]! } };
  return undefined;
}

/** Preload + seed the matched route's graph (called from the root middleware). */
export async function preloadForRequest(request: Request): Promise<ActiveRequestGraph | undefined> {
  const matched = resolveRoute(request.url);
  if (!matched) return undefined;
  return integration.preload({ request, params: matched.params, ctx: {} }, matched.operationName);
}

/** Serialize the active request's cache for the client (called from the root loader). */
export function activePayload(): GraphHydrationPayload | undefined {
  let active: ActiveGraph | undefined;
  try {
    active = scope.current();
  } catch {
    return undefined; // non-graph route (e.g. the "/" redirect)
  }
  return serializeGraph(active as unknown as ActiveRequestGraph, { clientSafeContext: [] });
}
