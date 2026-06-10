import { genClientJs, genClientDts, genServerJs, genServerDts, renderOperationTypes } from "../emit.js";
import { wrapRouteComponents } from "../transform.js";
import type { FrameworkPreset } from "../types.js";

/**
 * RedwoodSDK preset — React Server Components on workerd.
 *
 * Hydration rides the RSC flight stream: each route component is auto-wrapped with
 * `<GraphHydrate />` (the `transformRoute` hook), which renders the client
 * `GraphHydrator` with this request's serialized snapshot as a prop. So there is a
 * server-component glue (`./server`) and the route transform; the client glue owns
 * a private singleton (server and client components are distinct module graphs).
 */
export function rwsdk(): FrameworkPreset {
  return {
    name: "rwsdk",
    appDir: "src",
    requestScope: "rwsdk",
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
      return { js: genClientJs(opts), dts: genClientDts(caps, renderOperationTypes(ctx.operations, ctx.schemaModel)) };
    },
    emitServerGlue: () => ({ js: genServerJs("rwsdk"), dts: genServerDts() }),
    transformRoute: wrapRouteComponents,
    extraExports: () => ({
      "./server": { types: "./generated/server.d.ts", default: "./generated/server.js" },
    }),
  };
}
