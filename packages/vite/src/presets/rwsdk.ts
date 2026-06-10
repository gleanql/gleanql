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
    // The generated package MUST stay in the dep optimizer here (excluding it
    // un-wires RedwoodSDK's vendored React — two React copies, contexts/hooks
    // silently mismatch, islands render null). Staleness is solved by keying
    // the optimizer's cache on the generated operations instead: the define
    // value changes when any operation changes, which changes the optimizer
    // hash and forces a re-prebundle — same ops, warm cache.
    viteConfigPatch: (operations) => ({
      optimizeDeps: { esbuildOptions: { define: { __GLEANQL_OPS_DIGEST__: JSON.stringify(opsDigest(operations)) } } },
    }),
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

/** A stable fingerprint of the compiled operations (names + hashes), for the optimizer cache key. */
function opsDigest(operations: Record<string, { hash?: string }>): string {
  const parts = Object.entries(operations)
    .map(([name, op]) => `${name}:${op.hash ?? ""}`)
    .sort()
    .join("|");
  // djb2 — tiny, stable, no crypto needed: this only has to CHANGE when ops change.
  let h = 5381;
  for (let i = 0; i < parts.length; i++) h = ((h << 5) + h + parts.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
