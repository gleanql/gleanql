/** @jsx h */
import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeWithTs } from "@gleanql/compiler";
import type { CompiledOperation } from "@gleanql/client";
import {
  createGraphIntegration,
  serializeGraph,
  renderGraphHydrationScript,
  readGraphHydrationPayload,
  hydrateGraph,
  refetch,
  type GraphRouteContext,
  type RequestInfo,
} from "@gleanql/client";
import { storefrontSchema } from "../graph/schema-model.js";
import { scope } from "../graph/scope.js";
import { toVNode } from "./jsx-runtime.js";
import { renderToString } from "./render.js";
import { makeGraphAdapter, type ServerStats } from "./server.js";
import { ProductPage } from "./ProductPage.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * The route, run for real: compile ProductPage → execute the generated GraphQL
 * against an in-memory graphql-js server (via the adapter seam) → seed → render
 * the component tree to HTML by actually reading graph fields → serialize →
 * hydrate → render again on the "client". Not a mock: the document is executed
 * and the components are invoked.
 */
describe("storefront app (real end-to-end execution)", () => {
  const artifact = analyzeWithTs({
    fileName: path.join(here, "ProductPage.tsx"),
    supportDir: path.join(here, "../graph"),
    schema: storefrontSchema,
  }).operations[0]!;

  const operation: CompiledOperation<GraphRouteContext> = (() => {
    const src = artifact.variablesFactory.source.replace(/^export\s+/, "");
    const variables = new Function(`${src}\nreturn ${artifact.variablesFactory.exportName};`)() as (
      ctx: GraphRouteContext,
    ) => Record<string, unknown>;
    return { name: artifact.name, kind: artifact.kind, document: artifact.document, hash: artifact.hash, variables, readMap: artifact.readMap, selection: artifact.selection };
  })();

  const request = (): RequestInfo => ({
    request: new Request("https://shop.example/products/cool-shirt"),
    params: { handle: "cool-shirt" },
    ctx: {},
  });

  it("executes the route against a real GraphQL server and renders HTML", async () => {
    const stats: ServerStats = { requests: 0 };
    const adapter = makeGraphAdapter(stats);
    const integration = createGraphIntegration({ schema: storefrontSchema, operations: { [operation.name]: operation }, adapter, scope });

    const ri = request();
    await integration.preload(ri, operation.name);

    // Render the actual component tree; reads resolve through ~/graph → the cache.
    const serverHtml = await integration.runInScope(ri, () =>
      renderToString(toVNode(ProductPage({ params: { handle: "cool-shirt" } }))),
    );

    console.log("\n--- Server-rendered HTML ---\n" + serverHtml + "\n");
    expect(serverHtml).toContain("<h1>Cool Shirt</h1>");
    expect(serverHtml).toContain(`src="https://cdn.example/cool-shirt.png"`);
    expect(serverHtml).toContain("29.00 USD");
    expect(stats.requests).toBe(1); // one network round-trip for the whole page
  });

  it("hydrates on the client and renders identical HTML with no refetch", async () => {
    const stats: ServerStats = { requests: 0 };
    const adapter = makeGraphAdapter(stats);
    const integration = createGraphIntegration({ schema: storefrontSchema, operations: { [operation.name]: operation }, adapter, scope });

    const ri = request();
    const active = await integration.preload(ri, operation.name);
    const serverHtml = await integration.runInScope(ri, () =>
      renderToString(toVNode(ProductPage({ params: { handle: "cool-shirt" } }))),
    );

    // Serialize → script → recover on the "client".
    const payload = serializeGraph(active!, { clientSafeContext: [] });
    const script = renderGraphHydrationScript(payload, { globalKey: "__APP__" });
    const win = globalThis as Record<string, unknown>;
    new Function("window", script.replace(/^<script[^>]*>/, "").replace(/<\/script>$/, ""))(win);

    // Hydrate: rebuild the runtime + bind the graph + install it as the scope singleton.
    hydrateGraph(readGraphHydrationPayload("__APP__")!, { schema: storefrontSchema, adapter, scope });
    delete win["__APP__"];

    // Client render — `graph` now resolves the hydrated singleton (no scope.run needed).
    const requestsBeforeClientRender = stats.requests;
    const clientHtml = await renderToString(toVNode(ProductPage({ params: { handle: "cool-shirt" } })));

    expect(clientHtml).toBe(serverHtml);
    expect(stats.requests).toBe(requestsBeforeClientRender); // hydration served reads from cache
  });

  it("refetches on the client: fresh data lands, the cache notifies, re-render shows it", async () => {
    const stats: ServerStats = { requests: 0 };
    const adapter = makeGraphAdapter(stats);
    const integration = createGraphIntegration({ schema: storefrontSchema, operations: { [operation.name]: operation }, adapter, scope });

    // Server render + hydrate (views === 1 from the first fetch).
    const ri = request();
    const active = await integration.preload(ri, operation.name);
    const serverHtml = await integration.runInScope(ri, () =>
      renderToString(toVNode(ProductPage({ params: { handle: "cool-shirt" } }))),
    );
    expect(serverHtml).toContain("views 1");

    const payload = serializeGraph(active!, { clientSafeContext: [] });
    const { runtime } = hydrateGraph(payload, { schema: storefrontSchema, adapter, scope });

    // A useSyncExternalStore-style subscriber: re-renders when the cache changes.
    let notifications = 0;
    runtime.cache.subscribe(() => notifications++);

    expect((await renderToString(toVNode(ProductPage({ params: { handle: "cool-shirt" } })))).includes("views 1")).toBe(true);

    // Client refetch: bypasses cache-first, hits the server again (views === 2),
    // re-seeds the cache — which notifies subscribers.
    const before = stats.requests;
    await refetch({ operation, routeContext: active!.requestContext, adapter, context: {}, runtime });
    expect(stats.requests).toBe(before + 1); // a real network round-trip happened
    expect(notifications).toBeGreaterThan(0); // the cache notified the UI

    // Re-render reads the fresh value from the cache.
    const refreshed = await renderToString(toVNode(ProductPage({ params: { handle: "cool-shirt" } })));
    expect(refreshed).toContain("views 2");
  });
});
