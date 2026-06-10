import { jsx } from "react/jsx-runtime";
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
  readonly GraphHydrator: ComponentType<{ payload: GraphHydrationPayload; children?: ReactNode }>;
}

export interface GraphServer {
  GraphHydrate(props?: { clientSafeContext?: readonly string[]; children?: ReactNode }): ReactNode;
  withGraphHydration<P extends object>(Page: ComponentType<P>): ComponentType<P>;
}

export function createGraphServer(opts: GraphServerOptions): GraphServer {
  // The page renders INSIDE the hydrator: in the SSR pass the hydrator provides
  // this request's graph through React context (request-isolated by construction),
  // so `useGlean()` islands server-render warm. The payload prop still rides the
  // flight stream for the browser's hydration.
  function GraphHydrate(props?: { clientSafeContext?: readonly string[]; children?: ReactNode }): ReactNode {
    const active = opts.getActive();
    if (!active) return props?.children ?? null;
    const payload = serializeGraph(active, { clientSafeContext: props?.clientSafeContext ?? [] });
    return jsx(opts.GraphHydrator, { payload, children: props?.children });
  }

  function withGraphHydration<P extends object>(Page: ComponentType<P>): ComponentType<P> {
    return function GraphHydratedPage(props: P) {
      return jsx(GraphHydrate, { children: jsx(Page, props) });
    };
  }

  return { GraphHydrate, withGraphHydration };
}
