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
  createDevCache: () => ({ backendSession: { sourceFiles: new Map() } }),
}));
import { generate, regenerate } from "../src/generate.js";

const ops = (hash: string) => ({ Products: { hash } }) as never;
const result = (hash: string) => ({ routeComponents: new Map(), operations: ops(hash), diagnostics: [] });

function makeServer({ withRestart = true, withModuleLookup = false } = {}) {
  const handlers: Record<string, (file: string) => void> = {};
  const invalidateAll = vi.fn();
  const invalidateModule = vi.fn();
  const lookedUp: string[] = [];
  const moduleGraph = {
    invalidateAll,
    ...(withModuleLookup
      ? {
          getModulesByFile: (file: string) => {
            lookedUp.push(file);
            return new Set([{ file }]);
          },
          invalidateModule,
        }
      : {}),
  };
  const server = {
    middlewares: { use: vi.fn() },
    watcher: {
      add: vi.fn(),
      on: (event: string, handler: (file: string) => void) => {
        handlers[event] = handler;
      },
    },
    ws: { send: vi.fn() },
    environments: { worker: { moduleGraph } },
    moduleGraph,
    ...(withRestart ? { restart: vi.fn() } : {}),
  };
  return { server: server as unknown as GraphDevServer, handlers, invalidateAll, invalidateModule, lookedUp };
}

// A minimal preset; `operationsDigest` reads the single op's hash so tests
// control the fingerprint through the mocked regenerate result.
function preset(withDigest: boolean, volatileModules?: readonly string[], hotUpdateEvent?: string): FrameworkPreset {
  return {
    name: "test",
    appDir: "src",
    requestScope: "rwsdk",
    emitClientGlue: () => ({ js: "", dts: "" }),
    ...(withDigest
      ? { operationsDigest: (operations: Record<string, { hash?: string }>) => operations.Products?.hash ?? "" }
      : {}),
    ...(volatileModules ? { volatileModules } : {}),
    ...(hotUpdateEvent ? { hotUpdateEvent } : {}),
  };
}

async function boot(p: FrameworkPreset, serverOptions: Parameters<typeof makeServer>[0] = {}) {
  vi.mocked(generate).mockResolvedValue(result("h1"));
  const plugin = glean({ schema: "schema.graphql", framework: p });
  await plugin.config();
  const made = makeServer(serverOptions);
  plugin.configureServer(made.server);
  const edit = async (hash: string) => {
    vi.mocked(regenerate).mockResolvedValue(result(hash));
    made.handlers.change!(path.join(process.cwd(), "src", "page.tsx"));
    // 100ms debounce + the async rerun
    await new Promise((r) => setTimeout(r, 200));
  };
  return { ...made, edit };
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
    const { server, edit, invalidateAll } = await boot(preset(true), { withRestart: false });
    await edit("h2");
    expect(invalidateAll).toHaveBeenCalled();
    expect(server.ws?.send).toHaveBeenCalledWith({ type: "full-reload" });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("cannot restart"));
  });
});

describe("dev-time regeneration with volatile modules (true hot-swap)", () => {
  const VOLATILE = ["generated/operations.js", "generated/schema-model.js"];
  const pkgRoot = path.resolve(process.cwd(), "node_modules", "@gleanql", "client");

  it("hot-swaps on digest change: invalidates exactly the volatile modules, reloads, never restarts", async () => {
    const { server, edit, invalidateAll, invalidateModule, lookedUp } = await boot(preset(true, VOLATILE), {
      withModuleLookup: true,
    });
    await edit("h2");
    expect((server as { restart?: ReturnType<typeof vi.fn> }).restart).not.toHaveBeenCalled();
    expect(invalidateAll).not.toHaveBeenCalled();
    // both volatile files looked up in both graphs (worker env + fallback)
    for (const rel of VOLATILE) {
      expect(lookedUp.filter((f) => f === path.resolve(pkgRoot, rel))).toHaveLength(2);
    }
    expect(invalidateModule).toHaveBeenCalledTimes(VOLATILE.length * 2);
    expect(server.ws?.send).toHaveBeenCalledWith({ type: "full-reload" });
  });

  it("still does nothing when the digest is unchanged", async () => {
    const { server, edit, invalidateModule } = await boot(preset(true, VOLATILE), { withModuleLookup: true });
    await edit("h1");
    expect(invalidateModule).not.toHaveBeenCalled();
    expect(server.ws?.send).not.toHaveBeenCalled();
  });

  it("sends the preset's custom hot-update event instead of a full reload when declared", async () => {
    const { server, edit, invalidateModule } = await boot(preset(true, VOLATILE, "rsc:update"), {
      withModuleLookup: true,
    });
    await edit("h2");
    expect(invalidateModule).toHaveBeenCalled();
    expect(server.ws?.send).toHaveBeenCalledWith({ type: "custom", event: "rsc:update" });
    expect(server.ws?.send).not.toHaveBeenCalledWith({ type: "full-reload" });
    expect((server as { restart?: ReturnType<typeof vi.fn> }).restart).not.toHaveBeenCalled();
  });

  it("falls back to restart when the server lacks per-module invalidation", async () => {
    const { server, edit, invalidateAll } = await boot(preset(true, VOLATILE), { withModuleLookup: false });
    await edit("h2");
    expect((server as { restart?: ReturnType<typeof vi.fn> }).restart).toHaveBeenCalledTimes(1);
    expect(invalidateAll).not.toHaveBeenCalled();
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

  it("declares the volatile modules and excludes their bare specifier from the optimizer", async () => {
    const { rwsdk } = await vi.importActual<typeof import("../src/presets/index.js")>("../src/presets/index.js");
    const p = rwsdk();
    expect(p.volatileModules).toEqual(["generated/operations.js", "generated/schema-model.js"]);
    expect(p.viteConfigPatch!(ops("abc")).optimizeDeps?.exclude).toContain("@gleanql/client/operations");
    expect(p.hotUpdateEvent).toBe("rsc:update");
  });
});
