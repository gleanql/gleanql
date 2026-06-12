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
      optimizeDeps: {
        // The volatile data module stays OUT of the prebundle: generated code
        // reaches it through this exact bare specifier, the optimizer
        // externalizes it (exclude entries become esbuild externals), and the
        // module is served as plain source — invalidatable mid-session. The
        // digest define remains as a belt-and-braces re-key across restarts
        // for anything that still inlines a copy (e.g. rwsdk's client vendor
        // barrel, where staleness is tolerated — hydration is snapshot-driven).
        exclude: ["@gleanql/client/operations"],
        esbuildOptions: { define: { __GLEANQL_OPS_DIGEST__: JSON.stringify(opsDigest(operations)) } },
      },
    }),
    operationsDigest: opsDigest,
    // When the digest changes, invalidating exactly these served-as-source
    // modules (paths relative to the generated package) hot-swaps the
    // operations without a dev-server restart. schema-model.js is reached
    // relatively from operations.js, so it is its own module node and must be
    // invalidated alongside — the slim schema changes with the selections.
    volatileModules: ["generated/operations.js", "generated/schema-model.js"],
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
