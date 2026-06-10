import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";

import { Document } from "@/app/document";
import { NotesPage } from "@/app/pages/NotesPage";
// Everything graph-related is generated into node_modules by @gleanql/vite —
// the app imports only from `@gleanql/client`.
import { createGraphIntegration, operations, schema, type RequestInfo } from "@gleanql/client";
import { executeGraphQL, adapter } from "@/graphql";

export type AppContext = {};

// One integration: preloads each route's operation into the request graph
// (server reads run warm) and serves the island's mutations + refetches.
const integration = createGraphIntegration({ schema, operations, adapter });

/** Route interruptor: preload + seed the request graph before the page renders. */
function preload(operationName: string) {
  return async (requestInfo: RequestInfo) => {
    await integration.preload(requestInfo, operationName);
  };
}

export default defineApp([
  // The GraphQL endpoint the browser talks to for mutations + client refetch.
  route("/graphql", async ({ request }) => {
    const { query, variables } = (await request.json()) as { query: string; variables?: Record<string, unknown> };
    const result = await executeGraphQL(query, variables);
    return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
  }),
  render(Document, [route("/", [preload("NotesPage"), NotesPage])]),
]);
