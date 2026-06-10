import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeWithTs } from "@gleanql/compiler";
import type { CompiledOperation } from "@gleanql/client";
import {
  createGraphIntegration,
  serializeGraph,
  renderGraphHydrationScript,
  type GraphRouteContext,
} from "@gleanql/client";
import { storefrontSchema } from "../graph/schema-model.js";
import { scope } from "../graph/scope.js";
import { h } from "../app/jsx-runtime.js";
import { renderToString } from "../app/render.js";
import { makeGraphAdapter, type ServerStats } from "../app/server.js";
import { ProductPage } from "../app/ProductPage.js";
import { defineApp, route, type RequestInfo } from "./rwsdk-shim.js";

/**
 * A runnable RedwoodSDK-style worker.
 *
 * This is wired exactly as a real RWSDK app would be — a middleware preloads the
 * graph onto `ctx`, a `route` renders a Page, and a `Document` wraps the HTML and
 * injects the hydration payload — only `defineApp`/`route` come from a local shim
 * instead of `rwsdk/worker` (which needs workerd). Transport is an in-memory
 * graphql-js server implementing the adapter seam, so it runs with no network.
 */

// 1. Compile the route (the build step / @gleanql/vite would do this).
const here = path.dirname(fileURLToPath(import.meta.url));
const artifact = analyzeWithTs({
  fileName: path.join(here, "../app/ProductPage.tsx"),
  supportDir: path.join(here, "../graph"),
  schema: storefrontSchema,
}).operations[0]!;

const operation: CompiledOperation<GraphRouteContext> = (() => {
  const src = artifact.variablesFactory.source.replace(/^export\s+/, "");
  const variables = new Function(`${src}\nreturn ${artifact.variablesFactory.exportName};`)() as (
    ctx: GraphRouteContext,
  ) => Record<string, unknown>;
  return { name: artifact.name, kind: artifact.kind, document: artifact.document, hash: artifact.hash, variables, readMap: artifact.readMap };
})();

// 2. One graph integration for the worker: schema + operations + transport + scope.
export const serverStats: ServerStats = { requests: 0 };
const integration = createGraphIntegration({
  schema: storefrontSchema,
  operations: { [operation.name]: operation },
  adapter: makeGraphAdapter(serverStats),
  scope,
});

// 3. The Document — wraps the rendered Page and ships the hydration payload.
function Document({ children, requestInfo }: { children: string; requestInfo: RequestInfo }): string {
  const active = integration.getActive(requestInfo);
  const hydration = active
    ? renderGraphHydrationScript(serializeGraph(active, { clientSafeContext: [] }), { globalKey: "__RWSDK_GRAPH__" })
    : "";
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Storefront</title></head>` +
    `<body><div id="root">${children}</div>${hydration}</body></html>`
  );
}

// 4. The app: middleware-then-route, exactly like RWSDK's defineApp.
export const app = defineApp(
  [
    route("/products/:handle", async (requestInfo) => {
      const active = await integration.preload(requestInfo, operation.name);
      if (!active || active.roots.product == null) {
        return new Response("Product not found", { status: 404, headers: { "content-type": "text/plain" } });
      }
      // Returning the Page element — the framework renders it within the Document.
      return h(ProductPage, { params: requestInfo.params });
    }),
  ],
  {
    Document,
    // Render the Page with this request's runtime installed on the scope so
    // `import { graph } from "~/graph"` resolves inside the components.
    render: (vnode, requestInfo) => integration.runInScope(requestInfo, () => renderToString(vnode)),
  },
);

// Cloudflare Worker entrypoint shape.
export default { fetch: app.fetch };
