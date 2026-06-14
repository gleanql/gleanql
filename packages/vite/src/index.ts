// @gleanql/vite — the build plugin.
//
// Generates the schema-specific runtime (the `graph` accessor, branded types,
// compiled operations) INTO the `@gleanql/client` package the app installs, so app
// code imports everything from `@gleanql/client`. Runs before the host framework's
// module processing; see ./generate.ts for the pipeline.
//
// Everything framework-specific is owned by a FrameworkPreset (./presets) — appDir,
// request scope, which client/server glue to emit, and an optional route transform
// (e.g. RedwoodSDK's RSC auto-inject of `<GraphHydrate />`). The plugin core stays
// neutral and delegates. Adding a framework is a new preset, not a new branch.
//
// The build tools (@gleanql/codegen, @gleanql/compiler, @gleanql/core) are bundled into
// this package by tsdown; graphql / typescript / esbuild are kept external and
// resolved from the app at runtime.
import path from "node:path";
import { generate, regenerate, createDevCache, type GenerateResult, type DevCache } from "./generate.js";
import { renderDevtoolsHtml } from "./devtools.js";
import { resolvePreset } from "./presets/index.js";
import { bindComponentRefresh } from "./refresh-bind.js";
import { bindSelectorHookOps } from "./mutation-bind.js";
import { bindUseGleanComponent } from "./useglean-bind.js";
import type { GraphPluginOptions, GraphVitePlugin, GraphViteConfigPatch, GraphDevServer, GraphModuleGraph } from "./types.js";

export type { GraphPluginOptions, GraphVitePlugin, GraphViteConfigPatch, FrameworkPreset, FrameworkOption } from "./types.js";
export { rwsdk, reactRouter } from "./presets/index.js";
export { renderDevtoolsHtml } from "./devtools.js";
// The pipeline itself — for programmatic builds and the standalone-consumption e2e.
export { generate, type GenerateResult } from "./generate.js";

/**
 * Invalidate the preset's volatile generated modules (compiled operations +
 * slim schema model) in every environment's module graph. Returns false when
 * the server is too old to expose per-module invalidation — callers fall back
 * to a restart. The modules are served as source (their bare specifier is on
 * the optimizer's exclude list), so invalidation reaches the running worker on
 * its next request via vite's pull-based module renegotiation; vite propagates
 * the invalidation through each importer chain, which also re-evaluates
 * factory-time consumers (e.g. a persisted-operations resolver built from the
 * operations map).
 */
function invalidateVolatileModules(server: GraphDevServer, appRoot: string, modules: readonly string[]): boolean {
  const graphs = [...Object.values(server.environments ?? {}).map((env) => env.moduleGraph), server.moduleGraph].filter(
    (g): g is GraphModuleGraph => typeof g?.getModulesByFile === "function" && typeof g.invalidateModule === "function",
  );
  if (graphs.length === 0) return false;
  // generate.ts materializes the package at this fixed location.
  const pkgRoot = path.resolve(appRoot, "node_modules", "@gleanql", "client");
  for (const rel of modules) {
    const file = path.resolve(pkgRoot, rel);
    for (const graph of graphs) {
      const mods = graph.getModulesByFile?.(file);
      if (mods) for (const mod of mods) graph.invalidateModule?.(mod);
    }
  }
  return true;
}

export function glean(options: GraphPluginOptions): GraphVitePlugin {
  const preset = resolvePreset(options.framework);
  let done = false;
  let generated: GenerateResult = { routeComponents: new Map(), operations: {}, diagnostics: [] };
  // Dev-only caches (codegen + incremental TS program) shared across every
  // watcher-driven regeneration, so an edit re-checks only the changed file.
  // Created lazily in configureServer (dev); production `config()` builds never
  // touch it, so every build there is clean and from scratch.
  let devCache: DevCache | undefined;
  return {
    name: "graph",
    enforce: "pre",
    async config(): Promise<GraphViteConfigPatch> {
      if (!done) {
        generated = await generate(process.cwd(), options, preset);
        done = true;
      }
      // The dep optimizer vs generated code: a stale prebundle of the generated
      // package serves outdated operations across sessions ("unknown mutation
      // operation: …" until .vite is nuked by hand). How to prevent that is
      // framework-specific — see FrameworkPreset.viteConfigPatch.
      return preset.viteConfigPatch?.(generated.operations) ?? {};
    },

    // Dev-only: `/__glean` renders everything the build compiled — each operation's
    // document, hash, stats, per-component read map, and any compiler diagnostics.
    configureServer(server): void {
      server.middlewares.use((req, res, next) => {
        if ((req.url ?? "").split("?")[0] !== "/__glean") return next();
        res.setHeader("content-type", "text/html; charset=utf-8");
        res.end(renderDevtoolsHtml(generated.operations, generated.diagnostics));
      });

      // Dev-time regeneration: editing a route's reads must recompile its
      // operation NOW, not on the next server restart — otherwise new reads
      // silently resolve undefined against a stale operation. Watch the inputs
      // and re-run everything after provisioning. What happens next depends on
      // the preset: with `operationsDigest` (rwsdk) a real operations change
      // restarts the server (the digest-keyed prebundle can't be refreshed any
      // other way) and a no-op change does nothing; without it, invalidate
      // every module graph (the generated modules live in node_modules, which
      // vite won't invalidate on its own) and reload.
      const appRoot = process.cwd();
      devCache ??= createDevCache();
      const appDir = path.resolve(appRoot, preset.appDir) + path.sep;
      const schemaFile = path.resolve(appRoot, options.schema);
      const operationsFile = options.operations ? path.resolve(appRoot, options.operations) : undefined;
      server.watcher?.add(schemaFile); // may live outside the vite root

      const relevant = (file: string): boolean => {
        const abs = path.resolve(file);
        if (abs === schemaFile || abs === operationsFile) return true;
        return abs.startsWith(appDir) && /\.tsx?$/.test(abs) && !abs.includes(`${path.sep}node_modules${path.sep}`);
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      let running = false;
      let queued = false;
      let opsFingerprint = preset.operationsDigest?.(generated.operations);
      const rerun = async (): Promise<void> => {
        if (running) {
          queued = true;
          return;
        }
        running = true;
        try {
          generated = await regenerate(appRoot, options, preset, devCache);
          const next = preset.operationsDigest?.(generated.operations);
          if (next !== undefined) {
            // Fingerprinting preset: the digest decides everything. Unchanged ⇒
            // the generated package is byte-identical, vite's own HMR covers the
            // edit — invalidating here would only churn (and, against a digest-
            // keyed prebundle, churn is destructive). Changed ⇒ hot-swap the
            // volatile data modules when the preset declares them (they live
            // outside the prebundle, served as source, so targeted invalidation
            // takes effect on the next request); otherwise restart — the
            // prebundle is frozen and no invalidation can refresh it.
            if (next === opsFingerprint) return;
            opsFingerprint = next;
            if (preset.volatileModules?.length && invalidateVolatileModules(server, appRoot, preset.volatileModules)) {
              if (preset.hotUpdateEvent) {
                console.log(`[glean] operations changed — hot-swapped in place (${preset.hotUpdateEvent})`);
                // The in-process compile that just finished blocked the event
                // loop for seconds, so the browser's HMR socket often missed
                // heartbeats and is reconnecting RIGHT NOW — an event sent
                // only once tends to land in that gap and vanish. Send now
                // for still-connected clients and again after the reconnect
                // window; a duplicate is a no-op refetch.
                const notify = () => server.ws?.send({ type: "custom", event: preset.hotUpdateEvent! });
                notify();
                setTimeout(notify, 1500);
              } else {
                console.log("[glean] operations changed — hot-swapped the compiled operations (no restart)");
                server.ws?.send({ type: "full-reload" });
              }
              return;
            }
            if (server.restart) {
              console.log("[glean] operations changed — restarting the dev server to re-key the optimizer cache");
              void server.restart();
              return;
            }
            console.warn(
              "[glean] operations changed but this server cannot restart — falling back to module-graph invalidation; the dep optimizer's prebundle may now be stale",
            );
          }
          for (const env of Object.values(server.environments ?? {})) env.moduleGraph?.invalidateAll();
          server.moduleGraph?.invalidateAll();
          server.ws?.send({ type: "full-reload" });
        } catch (error) {
          console.error("[glean] regenerate failed:", error);
        } finally {
          running = false;
          if (queued) {
            queued = false;
            void rerun();
          }
        }
      };
      const kick = (file: string): void => {
        if (!relevant(file)) return;
        clearTimeout(timer);
        timer = setTimeout(() => void rerun(), 100); // coalesce editor save bursts
      };
      server.watcher?.on("change", kick);
      server.watcher?.on("add", kick);
      server.watcher?.on("unlink", kick);
    },
    transform(code, id) {
      const file = path.resolve(id.split("?")[0] ?? id);
      let out: string | null = null;

      // (1) Bind bare `refresh()` to its calling component — all frameworks, all
      // environments (islands run on the client), every source file.
      out = bindComponentRefresh(code, file) ?? out;

      // (1b) Bind `useMutation`/`useSubscription(selector)` to its compiled op name.
      out = bindSelectorHookOps(out ?? code, file) ?? out;

      // (1c) Read-masking only: bind `useGlean()` to its calling component so the
      // runtime can check reads against that component's compiled read-map.
      if (options.masking) out = bindUseGleanComponent(out ?? code, file) ?? out;

      // (2) RSC-only: auto-inject the <GraphHydrate /> hydrator around route
      // components (skipped in the client build, and for isomorphic presets).
      if (preset.transformRoute && this.environment?.name !== "client") {
        const names = generated.routeComponents.get(file);
        if (names) out = preset.transformRoute(out ?? code, file, names, console.warn) ?? out;
      }

      return out === null ? null : { code: out, map: null };
    },
  };
}
