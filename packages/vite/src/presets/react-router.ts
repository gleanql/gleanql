import { genClientSpaJs, genClientSpaDts, renderOperationTypes } from "../emit.js";
import type { FrameworkPreset } from "../types.js";

export interface ReactRouterPresetOptions {
  /**
   * The app's universal scope module (the `requestScope.from`). It must export both
   * `scope: GraphScope` (the shared scope the client glue installs the runtime on)
   * and `activeGraph` (the accessor resolver). Defaults to `"~/graph-scope"`.
   */
  readonly scopeModule?: string;
  /** Source dir scanned for route files. Defaults to `"app"` (React Router's convention). */
  readonly appDir?: string;
}

/**
 * React Router 7 (framework mode) preset — isomorphic SSR, NOT RSC.
 *
 * The same route component renders on the server and the client, so there is no
 * server-component glue and no route transform. Hydration uses the `<script>` /
 * loader-data model: the generated client glue resolves the runtime from the app's
 * SHARED scope (so the isomorphic `graph` accessor and `useGraph()` agree), and the
 * app calls `hydrate(payload)` from `entry.client` (initial) and per-navigation
 * loader data. `node:async_hooks` stays out of the client bundle because the scope
 * module is universal (`new GraphScope()`) and the ALS is attached server-side.
 */
export function reactRouter(opts: ReactRouterPresetOptions = {}): FrameworkPreset {
  const from = opts.scopeModule ?? "~/graph-scope";
  const requestScope = { import: "activeGraph", from } as const;
  return {
    name: "react-router",
    appDir: opts.appDir ?? "app",
    requestScope,
    emitClientGlue: (ctx) => {
      const caps = { mutation: !!ctx.schemaModel.mutationType, subscription: !!ctx.schemaModel.subscriptionType };
      const opts = {
        endpoint: ctx.endpoint,
        maxCacheRecords: ctx.maxCacheRecords,
        caps,
        persisted: ctx.persisted,
        gcKeepPages: ctx.gcKeepPages,
        masking: ctx.masking,
      };
      return { js: genClientSpaJs(requestScope, opts), dts: genClientSpaDts(caps, renderOperationTypes(ctx.operations, ctx.schemaModel)) };
    },
    // No emitServerGlue, no transformRoute, no extraExports — isomorphic SSR.
  };
}
