import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import type { ComponentType, ReactNode } from "react";
import { serializeGraph, type ActiveRequestGraph, type GraphHydrationPayload } from "./index.js";

/**
 * The server-side RSC glue. The generated `@gleanql/client/server` entrypoint is a
 * thin shim that passes its framework's active-graph resolver + the client
 * `GraphHydrator`, and re-exports `GraphHydrate`/`withGraphHydration`. Authored
 * here (typed) rather than as a template string.
 *
 * `GraphHydrate` serializes this request's cache and renders the client hydrator
 * with it as a prop, so the snapshot rides the RSC flight stream. `withGraphHydration`
 * is the HOC the build plugin uses to auto-wrap each route component.
 */
export interface GraphServerOptions {
  /** Resolve this request's active graph (null on non-graph routes). */
  readonly getActive: () => ActiveRequestGraph | null;
  /** The client hydrator component (from the generated client entrypoint). */
  readonly GraphHydrator: ComponentType<{ payload: GraphHydrationPayload }>;
}

export interface GraphServer {
  GraphHydrate(props?: { clientSafeContext?: readonly string[] }): ReactNode;
  withGraphHydration<P extends object>(Page: ComponentType<P>): ComponentType<P>;
}

export function createGraphServer(opts: GraphServerOptions): GraphServer {
  function GraphHydrate(props?: { clientSafeContext?: readonly string[] }): ReactNode {
    const active = opts.getActive();
    if (!active) return null;
    const payload = serializeGraph(active, { clientSafeContext: props?.clientSafeContext ?? [] });
    return jsx(opts.GraphHydrator, { payload });
  }

  function withGraphHydration<P extends object>(Page: ComponentType<P>): ComponentType<P> {
    return function GraphHydratedPage(props: P) {
      return jsxs(Fragment, { children: [jsx(GraphHydrate, {}), jsx(Page, props)] });
    };
  }

  return { GraphHydrate, withGraphHydration };
}
