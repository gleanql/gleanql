import { AsyncLocalStorage } from "node:async_hooks";
import { GraphScope } from "@gleanql/client";

/**
 * The app's request scope. Backed by AsyncLocalStorage so the active runtime
 * survives `await`s during an async render and concurrent requests stay isolated.
 * A framework adapter wraps rendering in `scope.run(active, render)`; the
 * module-level `graph` import (see graph.ts) resolves the runtime from here.
 */
export const scope = new GraphScope(new AsyncLocalStorage());

export function currentGraph() {
  return scope.current().graph;
}
