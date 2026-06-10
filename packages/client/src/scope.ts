import type { GraphRuntime } from "./runtime.js";
import type { BoundGraph } from "./proxy.js";

/**
 * Request-scoped runtime resolution.
 *
 * A module-level `import { graph } from "~/graph"` must resolve to *the runtime
 * for the current request* on the server (concurrent requests must not share a
 * cache) and to a single client runtime in the browser. `GraphScope` is the tiny
 * seam that makes that possible without threading a runtime through every prop.
 *
 * On the server, a framework adapter (RWSDK) wraps request handling in
 * `scope.run(active, fn)`. If the host exposes AsyncLocalStorage, concurrent
 * requests are isolated automatically; otherwise the adapter should resolve the
 * runtime from its own per-request context (`getGraph(requestInfo)`), which never
 * relies on a shared mutable global. On the client, `scope.set(active)` installs
 * the singleton after hydration.
 */
export interface ActiveGraph {
  readonly runtime: GraphRuntime;
  readonly graph: BoundGraph;
}

interface AsyncLocalStorageLike<T> {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
}

export class GraphScope {
  private singleton: ActiveGraph | undefined;
  private als: AsyncLocalStorageLike<ActiveGraph> | undefined;

  constructor(als?: AsyncLocalStorageLike<ActiveGraph>) {
    this.als = als;
  }

  /**
   * Attach an AsyncLocalStorage after construction — for isomorphic frameworks
   * (e.g. React Router) where the *same* `graph` accessor module loads in both
   * bundles: construct `new GraphScope()` in a universal, client-safe module (no
   * `node:async_hooks`), then a server-only module calls `attachAls(...)` to
   * upgrade it to per-request ALS isolation. `run`/`current` read `als`
   * dynamically, so the upgrade takes effect immediately; the client keeps using
   * the singleton set by `set()`.
   */
  attachAls(als: AsyncLocalStorageLike<ActiveGraph>): void {
    this.als = als;
  }

  /** The active graph, or throw a clear error if read outside any scope. */
  current(): ActiveGraph {
    const active = this.als?.getStore() ?? this.singleton;
    if (!active) {
      throw new Error(
        "No active graph runtime. On the server wrap rendering in scope.run(active, fn); on the client call scope.set(active) after hydration.",
      );
    }
    return active;
  }

  /** Run `fn` with `active` as the request-scoped runtime (server). */
  run<R>(active: ActiveGraph, fn: () => R): R {
    if (this.als) return this.als.run(active, fn);
    const prev = this.singleton;
    this.singleton = active;
    try {
      return fn();
    } finally {
      this.singleton = prev;
    }
  }

  /** Install the active graph as a singleton (client, post-hydration). */
  set(active: ActiveGraph): void {
    this.singleton = active;
  }
}

/**
 * Pair a {@link GraphScope} with a zero-arg resolver — the framework-agnostic
 * binding for the generated accessor. An app exports `activeGraph` and points
 * `@gleanql/vite`'s `requestScope: { import: "activeGraph", from: "..." }` at it,
 * then wraps server rendering in `scope.run(active, fn)` (or
 * `integration.runInScope`). Pass an `AsyncLocalStorage` to isolate concurrent
 * server requests; omit it for the client singleton.
 *
 * ```ts
 * import { AsyncLocalStorage } from "node:async_hooks";
 * export const { scope, activeGraph } = bindScope(new AsyncLocalStorage());
 * ```
 */
export function bindScope(
  als?: AsyncLocalStorageLike<ActiveGraph>,
): { scope: GraphScope; activeGraph: () => ActiveGraph } {
  const scope = new GraphScope(als);
  return { scope, activeGraph: () => scope.current() };
}
