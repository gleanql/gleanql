import { describe, it, expect } from "vitest";
import { app, serverStats } from "./worker.js";

/**
 * Proves the RWSDK-style worker actually runs: drive it the way Cloudflare does —
 * `worker.fetch(request)` — and assert the HTTP response. No mocks of our own
 * code; the route is matched, the graph is preloaded against the in-memory
 * GraphQL server, the Page is rendered, and the Document ships hydration state.
 */
describe("RWSDK worker (runs via fetch)", () => {
  it("renders the product page to an HTML response", async () => {
    const before = serverStats.requests;
    const res = await app.fetch(new Request("https://shop.example/products/cool-shirt"));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/html/);

    const html = await res.text();
    console.log("\n--- RWSDK worker response ---\n" + html + "\n");

    // Document shell + rendered Page.
    expect(html).toContain("<!doctype html>");
    expect(html).toContain(`<div id="root">`);
    expect(html).toContain("<h1>Cool Shirt</h1>");
    expect(html).toContain("29.00 USD");

    // Hydration payload is embedded for the client.
    expect(html).toContain("window[\"__RWSDK_GRAPH__\"]=");
    expect(html).toContain("Product:gid://shopify/Product/cool-shirt".replace(/</g, "\\u003c"));

    // One network round-trip served the whole page.
    expect(serverStats.requests).toBe(before + 1);
  });

  it("returns 404 for an unknown product handle", async () => {
    const res = await app.fetch(new Request("https://shop.example/products/does-not-exist"));
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Product not found");
  });

  it("returns 404 for an unmatched route", async () => {
    const res = await app.fetch(new Request("https://shop.example/about"));
    expect(res.status).toBe(404);
  });
});
