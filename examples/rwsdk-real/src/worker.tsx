import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";

import { Document } from "@/app/document";
import { setCommonHeaders } from "@/app/headers";
import { ProductPage } from "@/app/pages/ProductPage";
import { CollectionPage } from "@/app/pages/CollectionPage";
// Everything graph-related is generated into node_modules by the vite plugin —
// the app imports only from `@gleanql/client`. No committed schema/operation/accessor glue.
import {
  createGraphIntegration,
  createPersistedResolver,
  operations,
  schema,
  type PersistedRequestBody,
  type RequestInfo,
} from "@gleanql/client";
import { makeGraphAdapter, executeGraphQL, subscribeProductChanged } from "@gleanql/storefront-fixture";

export type AppContext = {
  __graph?: unknown;
};

const integration = createGraphIntegration({
  schema,
  operations,
  adapter: makeGraphAdapter(),
});

// The persisted-operation allowlist: the build compiled every operation this app
// can send (and `persisted: true` in vite.config makes the client send only the
// sha-256 hash), so the endpoint executes exactly those — nothing free-form.
const resolvePersisted = createPersistedResolver(operations);

/** Route interruptor: preload + seed the graph; 404 if the root is missing. */
function preload(operationName: string) {
  return async (requestInfo: RequestInfo) => {
    const active = await integration.preload(requestInfo, operationName);
    if (!active || Object.values(active.roots)[0] == null) {
      return new Response("Not found", { status: 404 });
    }
  };
}

export default defineApp([
  setCommonHeaders(),
  // The GraphQL endpoint the browser talks to for client-side refetch. Requests
  // arrive BY HASH (persisted mode); the resolver maps them to the build's
  // allowlisted documents and rejects anything else.
  route("/graphql", async ({ request }) => {
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const body = (await request.json()) as PersistedRequestBody;
    const resolved = resolvePersisted(body);
    if (resolved.kind === "not-found") {
      // The APQ signal: "send me the document" (the build seeded this allowlist,
      // so in practice only an out-of-date client ever sees it).
      return json({ errors: [{ message: "PersistedQueryNotFound" }] });
    }
    if (resolved.kind === "rejected") {
      return json({ errors: [{ message: "Operation not in the persisted allowlist" }] }, 400);
    }
    const result = await executeGraphQL(resolved.document, body.variables as Record<string, unknown> | undefined);
    return json(result);
  }),
  // The subscription endpoint: a Server-Sent Events stream the client's `useSubscription`
  // consumes (via EventSource). Each `data:` frame is a GraphResult that normalizes into
  // the client cache. A real app would back this with a WebSocket / pub-sub.
  route("/graphql/stream", ({ request }) => {
    const variables = JSON.parse(new URL(request.url).searchParams.get("variables") ?? "{}");
    const handle = String((variables as { handle?: unknown }).handle ?? "");
    const ac = new AbortController();
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        try {
          for await (const frame of subscribeProductChanged(handle, ac.signal)) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`));
          }
        } catch {
          /* client gone */
        } finally {
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      },
      cancel() {
        ac.abort();
      },
    });
    return new Response(stream, {
      headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
    });
  }),
  render(Document, [
    route("/", () => new Response(null, { status: 302, headers: { Location: "/collections/all" } })),
    route("/collections/:handle", [preload("CollectionPage"), CollectionPage]),
    route("/products/:handle", [preload("ProductPage"), ProductPage]),
  ]),
]);
