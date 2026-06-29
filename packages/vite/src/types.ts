import { type OperationArtifact, type SchemaModel } from "@gleanql/core";

/**
 * How the generated `graph` accessor finds the active per-request runtime.
 *
 * - `"rwsdk"` (default): read RedwoodSDK's `requestInfo.ctx` (`import { requestInfo }
 *   from "rwsdk/worker"`).
 * - `{ import, from }`: call a resolver the app exports — `import { <import> } from
 *   "<from>"` — returning the active graph (e.g. `() => scope.current()` backed by
 *   a {@link GraphScope}). This is the framework-agnostic seam: any SSR host that
 *   can scope a value per request (AsyncLocalStorage, a context object) plugs in
 *   here without `@gleanql/client` knowing the framework.
 */
export type RequestScope = "rwsdk" | { readonly import: string; readonly from: string };

/** What a preset's glue generators receive: the compiled schema + operations + transport URL. */
export interface PresetEmitContext {
  readonly schemaModel: SchemaModel;
  readonly operations: Record<string, OperationArtifact>;
  /** URL the client POSTs to for refetch. */
  readonly endpoint: string;
  /** Optional LRU cap baked into the client cache (the client cache accumulates across navigations). */
  readonly maxCacheRecords?: number;
  /** Send operations by sha-256 hash (persisted-operation mode). */
  readonly persisted?: boolean;
  /** Staleness-aware GC: collect unretained records untouched for N page generations. */
  readonly gcKeepPages?: number;
  /** Dev read-masking: warn when a component reads outside its compiled read-map. */
  readonly masking?: boolean;
}

/** A generated module: its JS source and matching `.d.ts`. */
export interface GeneratedModule {
  readonly js: string;
  readonly dts: string;
}

/** A `package.json` subpath export entry. */
export interface SubpathExport {
  readonly types: string;
  readonly default: string;
}

/**
 * A framework binding. It owns every framework-specific decision so the build
 * pipeline (`generate.ts`/`index.ts`) stays neutral: where route files live, how
 * the generated accessor resolves the per-request runtime, which client/server
 * glue to emit, whether route modules are transformed, and which subpath exports
 * the generated package gets. Add a framework = add a preset, not a new branch.
 */
export interface FrameworkPreset {
  readonly name: string;
  /** Source dir scanned for route files, relative to app root (rwsdk `"src"`, RR7 `"app"`). */
  readonly appDir: string;
  /** How the generated `graph` accessor resolves the active runtime. */
  readonly requestScope: RequestScope;
  /** Generated `@gleanql/client/client` glue (`useGraph`/`refresh` + hydration). */
  emitClientGlue(ctx: PresetEmitContext): GeneratedModule;
  /** Optional `@gleanql/client/server` glue (RSC server component). Omit ⇒ none. */
  emitServerGlue?(ctx: PresetEmitContext): GeneratedModule;
  /** Optional route-module transform (RSC auto-inject). Omit ⇒ no transform runs. */
  transformRoute?(code: string, file: string, names: ReadonlySet<string>, onWarn?: (m: string) => void): string | null;
  /** Subpath exports beyond the always-present `.`, `./schema`, `./runtime`, `./operations`, `./client`. */
  extraExports?(): Record<string, SubpathExport>;
  /**
   * Per-preset vite-config patch, applied after generation. The dep optimizer
   * is the footgun here: it must either skip the generated package entirely
   * (react-router — esbuild can't apply the app's `~/` alias inside the glue)
   * or have its cache key tied to the generated operations (rwsdk — excluding
   * the package would un-wire the framework's vendored React, but a stale
   * prebundle serves outdated operations across sessions).
   */
  viteConfigPatch?(operations: Record<string, OperationArtifact>): GraphViteConfigPatch;
  /**
   * A stable fingerprint of the compiled operations. Providing this changes
   * dev-time regeneration semantics: when the fingerprint is UNCHANGED the
   * plugin skips module-graph invalidation entirely (the generated package is
   * byte-identical — vite's own HMR covers the edit), and when it CHANGES the
   * plugin restarts the dev server instead of invalidating. Presets that key
   * the dep optimizer's cache on this digest (rwsdk) need the restart: their
   * prebundle is frozen per server lifetime, so `invalidateAll()` re-evaluates
   * source modules against a stale prebundle and splits the worker into mixed
   * module generations ("graph not preloaded", "Request context not found",
   * "Currently React only supports one RSC renderer"). A restart re-runs
   * `config()`, which re-keys the optimizer and rebuilds a coherent bundle.
   */
  operationsDigest?(operations: Record<string, OperationArtifact>): string;
  /**
   * Generated modules (paths relative to the generated package root) whose
   * content changes whenever `operationsDigest` changes. When present, a
   * digest change is applied by invalidating exactly these modules in every
   * environment plus a full browser reload — true hot-swap, no dev-server
   * restart. Valid only when every prebundle-bound reference to them uses a
   * bare specifier on the optimizer's exclude list (relative imports get
   * inlined into the frozen prebundle and would keep serving stale data).
   * Without this field, a digest change falls back to a server restart.
   */
  readonly volatileModules?: readonly string[];
  /**
   * Custom HMR event to send after a volatile-module hot-swap instead of a
   * full browser reload. For frameworks whose client runtime can re-render in
   * place (rwsdk: `"rsc:update"` — the client refetches the RSC payload and
   * React reconciles), this makes an operation change visually identical to
   * any other hot update. Omit ⇒ full reload after the swap.
   */
  readonly hotUpdateEvent?: string;
}

/** Built-in preset name or a custom preset object. Defaults to `"rwsdk"`. */
export type FrameworkOption = FrameworkPreset | "rwsdk" | "react-router";

export interface GraphPluginOptions {
  /** Path to a `.graphql` SDL file, relative to the app root. */
  readonly schema: string;
  /**
   * Route files to compile, relative to the app root. Optional — when omitted,
   * routes are auto-discovered (any file under the preset's `appDir` that calls a
   * `graph` root). Provide an explicit list to override discovery.
   */
  readonly routes?: readonly string[];
  /**
   * URL the generated client (`@gleanql/client/client`) POSTs to for client-side
   * refetch. Defaults to `"/graphql"`. (The app still serves this endpoint.)
   */
  readonly endpoint?: string;
  /** Framework binding (built-in name or a custom {@link FrameworkPreset}). Default `"rwsdk"`. */
  readonly framework?: FrameworkOption;
  /**
   * The callee name of a framework's SERVER mutation primitive, e.g. `"mutate"`
   * for `await mutate((m, vars) => m.field(vars)..., vars)` in a server action /
   * webhook / job. When set, a call to it compiles its selector into a mutation
   * operation (like `useMutation`) and the binding transform injects the op name;
   * the framework provides the runtime that executes the compiled op server-side.
   * Unset ⇒ no server-mutate callee (Glean doesn't claim a name).
   */
  readonly serverMutate?: string;
  /**
   * Host package that transitively provides `@gleanql/client` (and its
   * `@gleanql/core` dep) — e.g. a meta-framework that re-exports the `glean`
   * accessor so consuming apps never declare `@gleanql/client` themselves.
   * When set, runtime provisioning resolves the client/core SOURCE through this
   * package (the same transitive resolution already used for `@gleanql/core`)
   * if the app manifest doesn't declare `@gleanql/client` directly. The
   * generated runtime is still written app-locally to
   * `node_modules/@gleanql/client`; this only changes where the pristine source
   * is read from.
   */
  readonly clientFrom?: string;
  /**
   * Type engine used to compile routes. `"typescript"` (default) is the in-process
   * compiler; `"tsgo"` is the experimental Go-native engine
   * (`@typescript/native-preview`) — much faster type-checking on large route sets,
   * but pre-release. Falls back to `"typescript"` if the optional dep is absent.
   */
  readonly backend?: "typescript" | "tsgo";
  /**
   * Cap the long-lived client cache at N records (LRU eviction past it). Opt-in;
   * default is unbounded. Only enable with a real `fetchMissing`, since an evicted
   * record re-read otherwise resolves to `undefined`.
   */
  readonly maxCacheRecords?: number;
  /**
   * Fail the build when the compiler emits any diagnostic (unsupported pattern).
   * Default `false` — diagnostics are logged as warnings (the affected reads just
   * won't be in the operation). Turn on in CI to catch drift.
   */
  readonly strict?: boolean;
  /**
   * Persisted-operation mode: the generated client sends operations BY HASH
   * (`extensions.persistedQuery.sha256Hash` — the APQ wire shape) instead of by
   * document. Pair the server with `createPersistedResolver(operations)` (same
   * deploy) or sync the emitted `generated/persisted.json` manifest to it. The
   * client retries once with the document if the server answers
   * `PersistedQueryNotFound`.
   */
  readonly persisted?: boolean;
  /**
   * Staleness-aware GC (opt-in): on each client navigation, collect cache records
   * that are unretained AND untouched for this many page generations. Unset = no
   * automatic collection — "unretained" alone is not a reason to drop valid data
   * (back-navigation should hit a warm cache); `maxCacheRecords` bounds capacity,
   * this bounds staleness. `gcKeepPages: 2` keeps ~the last two pages warm.
   */
  readonly gcKeepPages?: number;
  /**
   * REGISTERED operations: a module (path relative to the app root) whose exports
   * are hand-built `OperationIR`s (`buildQuery(...)` from @gleanql/core) — the escape
   * hatch for shapes the compiler can't extract. The build RUNS the module, prints +
   * hashes each export, and ships them like compiled operations: same generated
   * map, same persisted manifest/allowlist, same devtools. Execute at runtime with
   * `runOperation(name, variables)` from `@gleanql/client/client`.
   */
  readonly operations?: string;
  /**
   * Dev READ-MASKING (opt-in): warn when a component reads a `Type.field` outside
   * its own compiled read-map — it's rendering data another component fetched,
   * which goes stale or missing when that component's reads change (Relay's
   * masking discipline as a dev warning). Enable in dev only, e.g.
   * `masking: process.env.NODE_ENV !== "production"` — the mask data and the
   * `useGlean("Component")` binding are only emitted when on.
   */
  readonly masking?: boolean;
}

/** Vite's `PluginContext`, narrowed to the `environment` we read (structural — no vite dep). */
export interface GraphPluginContext {
  readonly environment?: { readonly name?: string };
}

/** The slice of Vite's `Plugin` contract we implement (kept structural to avoid a vite dependency). */
/** The slice of a Vite module graph we use (structural — no vite dep). */
export interface GraphModuleGraph {
  invalidateAll(): void;
  /** Look up the module nodes a file backs (vite keys by absolute path, no query). */
  getModulesByFile?(file: string): Set<object> | undefined;
  /** Invalidate one module; vite propagates through its importer chain. */
  invalidateModule?(mod: object): void;
}

/** The slice of Vite's dev server we use in `configureServer` (structural — no vite dep). */
export interface GraphDevServer {
  readonly middlewares: {
    use(
      handler: (
        req: { readonly url?: string },
        res: { setHeader(name: string, value: string): void; end(body: string): void },
        next: () => void,
      ) => void,
    ): void;
  };
  /** Vite's chokidar instance — drives dev-time regeneration. */
  readonly watcher?: {
    add(path: string): void;
    on(event: "change" | "add" | "unlink", handler: (file: string) => void): void;
  };
  /** Hot channel to the browser — full reload or a framework custom event after operations change. */
  readonly ws?: { send(payload: { type: "full-reload" } | { type: "custom"; event: string }): void };
  /** Vite 6 environment API (rwsdk runs client + worker environments). */
  readonly environments?: Record<string, { readonly moduleGraph?: GraphModuleGraph }>;
  /** Pre-environment fallback module graph. */
  readonly moduleGraph?: GraphModuleGraph;
  /**
   * Restart the dev server. Used instead of invalidation when a preset's
   * `operationsDigest` changes — the only way to refresh a digest-keyed
   * prebundle. Vite restarts in-process: same port, watchers re-arm.
   */
  restart?(): void | Promise<void>;
}

/** The vite-config patch the plugin contributes (merged by vite). Mutable
 * shapes on purpose: vite's `UserConfig` wants `string[]`, not `readonly`. */
export interface GraphViteConfigPatch {
  optimizeDeps?: {
    exclude?: string[];
  };
}

/** The slice of Vite's `ConfigEnv` we read (structural — no vite dep). */
export interface GraphConfigEnv {
  readonly command: "build" | "serve";
}

export interface GraphVitePlugin {
  readonly name: string;
  readonly enforce: "pre";
  config(config: unknown, env: GraphConfigEnv): Promise<GraphViteConfigPatch>;
  /** Dev-only: serves the `/__glean` devtools overlay. */
  configureServer(server: GraphDevServer): void;
  transform(
    this: GraphPluginContext,
    code: string,
    id: string,
  ): { code: string; map: null } | null;
}
