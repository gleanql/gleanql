import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";

import { Document } from "@/app/document";
import { setCommonHeaders } from "@/app/headers";
import { TodoPage } from "@/app/pages/TodoPage";
// Everything graph-related is generated into node_modules by the @gleanql/vite plugin —
// the app imports only from `@gleanql/client`. No committed schema/operation/accessor glue.
import { createGraphIntegration, operations, schema, type RequestInfo } from "@gleanql/client";
import { makeTodoAdapter, executeGraphQL } from "@/graphql/executor";

// The SQLite Durable Object that owns the data MUST be exported from the worker entry
// so the Cloudflare runtime can instantiate it (bound as `TODO_DB` in wrangler.jsonc).
export { TodoDatabase } from "@/db";

export type AppContext = {};

// One integration: it preloads each route's operation into the request graph (SSR
// reads run warm) and serves client refetch/mutations — all over the DB-backed adapter.
const integration = createGraphIntegration({
  schema,
  operations,
  adapter: makeTodoAdapter(),
});

/** Route interruptor: preload + seed the request graph before the page renders. */
function preload(operationName: string) {
  return async (requestInfo: RequestInfo) => {
    await integration.preload(requestInfo, operationName);
  };
}

export default defineApp([
  setCommonHeaders(),
  // The GraphQL endpoint the browser talks to for mutations + client refetch.
  route("/graphql", async ({ request }) => {
    const { query, variables } = (await request.json()) as { query: string; variables?: Record<string, unknown> };
    const result = await executeGraphQL(query, variables);
    return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  }),
  render(Document, [route("/", [preload("TodoPage"), TodoPage])]),
]);
