import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { glean } from "../src/index.js";
import type { FrameworkPreset, GraphDevServer } from "../src/types.js";

// The regeneration pipeline is exercised elsewhere (emit/discover tests); here
// we mock it to drive the watcher's DECISION logic: restart vs invalidate vs
// nothing, depending on the preset's operations fingerprint.
vi.mock("../src/generate.js", () => ({
  generate: vi.fn(),
  regenerate: vi.fn(),
}));
import { generate, regenerate } from "../src/generate.js";

const ops = (hash: string) => ({ Products: { hash } }) as never;
const result = (hash: string) => ({ routeComponents: new Map(), operations: ops(hash), diagnostics: [] });

function makeServer(withRestart = true) {
  const handlers: Record<string, (file: string) => void> = {};
  const invalidateAll = vi.fn();
  const server = {
    middlewares: { use: vi.fn() },
    watcher: {
      add: vi.fn(),
      on: (event: string, handler: (file: string) => void) => {
        handlers[event] = handler;
      },
    },
    ws: { send: vi.fn() },
    environments: { worker: { moduleGraph: { invalidateAll } } },
    moduleGraph: { invalidateAll },
    ...(withRestart ? { restart: vi.fn() } : {}),
  };
  return { server: server as unknown as GraphDevServer, handlers, invalidateAll };
}

// A minimal preset; `operationsDigest` reads the single op's hash so tests
// control the fingerprint through the mocked regenerate result.
function preset(withDigest: boolean): FrameworkPreset {
  return {
    name: "test",
    appDir: "src",
    requestScope: "rwsdk",
    emitClientGlue: () => ({ js: "", dts: "" }),
    ...(withDigest
      ? { operationsDigest: (operations: Record<string, { hash?: string }>) => operations.Products?.hash ?? "" }
      : {}),
  };
}

async function boot(p: FrameworkPreset, withRestart = true) {
  vi.mocked(generate).mockResolvedValue(result("h1"));
  const plugin = glean({ schema: "schema.graphql", framework: p });
  await plugin.config();
  const { server, handlers, invalidateAll } = makeServer(withRestart);
  plugin.configureServer(server);
  const edit = async (hash: string) => {
    vi.mocked(regenerate).mockResolvedValue(result(hash));
    handlers.change!(path.join(process.cwd(), "src", "page.tsx"));
    // 100ms debounce + the async rerun
    await new Promise((r) => setTimeout(r, 200));
  };
  return { server, edit, invalidateAll };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("dev-time regeneration with a fingerprinting preset", () => {
  it("does nothing when the operations digest is unchanged (text-only edit)", async () => {
    const { server, edit, invalidateAll } = await boot(preset(true));
    await edit("h1");
    expect(regenerate).toHaveBeenCalledTimes(1);
    expect((server as { restart?: unknown }).restart).not.toHaveBeenCalled();
    expect(invalidateAll).not.toHaveBeenCalled();
    expect(server.ws?.send).not.toHaveBeenCalled();
  });

  it("restarts the server when the digest changes — never invalidates the frozen prebundle", async () => {
    const { server, edit, invalidateAll } = await boot(preset(true));
    await edit("h2");
    expect((server as { restart?: ReturnType<typeof vi.fn> }).restart).toHaveBeenCalledTimes(1);
    expect(invalidateAll).not.toHaveBeenCalled();
    expect(server.ws?.send).not.toHaveBeenCalled();
  });

  it("does not restart again for a follow-up edit with the same digest", async () => {
    const { server, edit } = await boot(preset(true));
    await edit("h2");
    await edit("h2");
    expect((server as { restart?: ReturnType<typeof vi.fn> }).restart).toHaveBeenCalledTimes(1);
  });

  it("falls back to invalidation + full reload when the server cannot restart", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { server, edit, invalidateAll } = await boot(preset(true), false);
    await edit("h2");
    expect(invalidateAll).toHaveBeenCalled();
    expect(server.ws?.send).toHaveBeenCalledWith({ type: "full-reload" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("cannot restart"));
  });
});

describe("dev-time regeneration without a fingerprint", () => {
  it("keeps the unconditional invalidate + full-reload behavior", async () => {
    const { server, edit, invalidateAll } = await boot(preset(false));
    await edit("h1");
    expect(invalidateAll).toHaveBeenCalled();
    expect(server.ws?.send).toHaveBeenCalledWith({ type: "full-reload" });
    expect((server as { restart?: ReturnType<typeof vi.fn> }).restart).not.toHaveBeenCalled();
  });
});

describe("rwsdk preset wiring", () => {
  it("exposes operationsDigest matching the optimizer define key", async () => {
    const { rwsdk } = await vi.importActual<typeof import("../src/presets/index.js")>("../src/presets/index.js");
    const p = rwsdk();
    const operations = ops("abc");
    const digest = p.operationsDigest!(operations);
    const patch = p.viteConfigPatch!(operations);
    expect(patch.optimizeDeps?.esbuildOptions?.define?.__GLEANQL_OPS_DIGEST__).toBe(JSON.stringify(digest));
    // a different hash must move the fingerprint
    expect(p.operationsDigest!(ops("abd"))).not.toBe(digest);
  });
});
