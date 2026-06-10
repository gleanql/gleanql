import { describe, it, expect } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { GraphScope, type ActiveGraph } from "../src/index.js";

const active = (label: string) => ({ runtime: { label }, graph: { label } }) as unknown as ActiveGraph;

describe("GraphScope.attachAls (isomorphic scope)", () => {
  it("upgrades a singleton scope to ALS isolation after construction", async () => {
    const scope = new GraphScope(); // client-safe: no ALS at construction
    // Before attach, the singleton path works (the client model).
    scope.set(active("singleton"));
    expect((scope.current().runtime as unknown as { label: string }).label).toBe("singleton");

    // Attach an ALS (the server model) — run() now isolates per async context.
    scope.attachAls(new AsyncLocalStorage<ActiveGraph>());
    const seen = scope.run(active("req"), () => (scope.current().runtime as unknown as { label: string }).label);
    expect(seen).toBe("req");
  });

  it("isolates concurrent scope.run after attach", async () => {
    const scope = new GraphScope();
    scope.attachAls(new AsyncLocalStorage<ActiveGraph>());

    const probe = (label: string) =>
      scope.run(active(label), async () => {
        await new Promise((r) => setTimeout(r, label === "a" ? 5 : 1));
        return (scope.current().graph as unknown as { label: string }).label; // must still see its own active after the await
      });

    const [a, b] = await Promise.all([probe("a"), probe("b")]);
    expect(a).toBe("a");
    expect(b).toBe("b");
  });

  it("falls back to the singleton when no ALS context is active", () => {
    const scope = new GraphScope();
    scope.attachAls(new AsyncLocalStorage<ActiveGraph>());
    scope.set(active("fallback")); // outside any run(): current() uses the singleton
    expect((scope.current().graph as unknown as { label: string }).label).toBe("fallback");
  });
});
