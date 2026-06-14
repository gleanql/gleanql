import * as esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { buildSchema, introspectionFromSchema } from "graphql";
import { generateGraph, generateSchemaModel, generateTypes, type IntrospectionSchema } from "@gleanql/codegen";
import {
  analyzeFile,
  createBackend,
  createBackendSession,
  createTsgoBackend,
  type AstFacade,
  type BackendOptions,
  type GraphCompilerBackend,
  type BackendSession,
} from "@gleanql/compiler";
import type { OperationArtifact, SchemaModel } from "@gleanql/core";
import { emitDeclarations, listTsx, provisionPackage, readAppPaths, resolveRuntimeSources, transpileDir } from "./provision.js";
import { addRegisteredOperations, loadRegisteredOperations } from "./registered.js";
import { renderSlimSchemaModelJs, slimRuntimeSchema } from "./slim-schema.js";
import {
  evalSchemaModel,
  genGeneratedJs,
  genOperationsJs,
  genIndexDts,
  genOperationsDts,
  genPersistedManifest,
  genTestingJs,
  genTestingDts,
  renderReadMask,
} from "./emit.js";
import type { FrameworkPreset, GraphPluginOptions, SubpathExport } from "./types.js";
import { resolvePreset } from "./presets/index.js";

const CLIENT = "@gleanql/client";

/** True if the module opens with a `"use client"` / `'use client'` directive. */
function isClientModule(source: string): boolean {
  // Tolerate leading whitespace and line/block comments before the directive.
  return /^\s*(?:(?:\/\/[^\n]*|\/\*[\s\S]*?\*\/)\s*)*["']use client["']/.test(source);
}

/**
 * A route is any module that opens a `graph` root — `graph.product(...)`. That's
 * the definition the analyzer already uses per-component, lifted to file level so
 * routes are discovered, not hand-listed. A cheap textual probe (any `graph.<root>(`
 * call); false positives just analyze to zero operations, so it stays permissive.
 *
 * `"use client"` modules are excluded: a client island can read graph fields, but
 * it is never an RSC route entrypoint — its reads are served from the hydrated
 * cache (and folded into the owning route's operation server-side).
 */
export function isRouteFile(source: string, rootFields: readonly string[]): boolean {
  if (rootFields.length === 0) return false;
  if (isClientModule(source)) return false;
  return new RegExp(`\\bglean\\s*\\.\\s*(?:${rootFields.join("|")})\\s*\\(`).test(source);
}

/**
 * Maps each route file (absolute path) to the names of its route components — the
 * exported symbols the auto-inject transform wraps with `<GraphHydrate />`.
 */
export type RouteComponents = Map<string, Set<string>>;

interface Codegen {
  readonly introspection: IntrospectionSchema;
  readonly typesSrc: string;
  readonly schemaModelSrc: string;
  readonly graphStubSrc: string;
  readonly schemaModel: SchemaModel;
}

interface Discovery {
  /** Every `.tsx` under the app dir — the full program the backend type-checks. */
  readonly allFiles: readonly string[];
  /** Files to extract operations from: routes + selector-hook islands. */
  readonly analyzeFiles: readonly string[];
  /** The app's tsconfig path aliases, so imports resolve during analysis. */
  readonly appPaths: ReturnType<typeof readAppPaths>;
}

/**
 * Provision the `@gleanql/client` runtime into the app's node_modules and fill its
 * `generated/` slot from the schema + route files. Framework-specific decisions
 * (appDir, request scope, which glue to emit, subpath exports) are delegated to the
 * resolved {@link FrameworkPreset}. Returns the route-component map so the plugin's
 * `transform` hook can run the preset's optional route transform.
 *
 * The pipeline is six steps: provision the runtime → codegen from the SDL → write the
 * package skeleton → discover the files to analyze → compile them to operations →
 * emit the generated modules. Each is its own function below.
 */
/** Everything a build produced — the transform needs `routeComponents`; the dev overlay shows the rest. */
export interface GenerateResult {
  readonly routeComponents: RouteComponents;
  readonly operations: Record<string, OperationArtifact>;
  readonly diagnostics: readonly string[];
}

/**
 * Dev-only caches that persist across regenerations to make HMR fast. Create one
 * per dev server (`createDevCache()`) and pass it to every `regenerate` call.
 * Two caches, the two dominant costs (measured ~250ms + ~800ms on the Shopify
 * Admin schema): the codegen result (the SDL is static within a session) and the
 * type-engine's incremental program (a single-file edit re-checks only that file
 * and its dependents instead of rebuilding the whole program). Omit the cache
 * (production builds) and every regeneration is a clean, from-scratch build.
 */
export interface DevCache {
  codegen?: { sdl: string; result: Codegen };
  readonly backendSession: BackendSession;
}

export function createDevCache(): DevCache {
  return { backendSession: createBackendSession() };
}

export async function generate(
  appRoot: string,
  options: GraphPluginOptions,
  preset: FrameworkPreset = resolvePreset(options.framework),
): Promise<GenerateResult> {
  const out = path.join(appRoot, "node_modules", CLIENT);
  await provisionRuntime(appRoot, out, options.clientFrom);
  return regenerate(appRoot, options, preset);
}

/**
 * Everything AFTER provisioning: codegen → skeleton → discover → analyze → emit.
 * This is what dev-time file watching re-runs — the provisioned runtime never
 * changes within a session, but routes/schema/registered-operations do.
 */
export async function regenerate(
  appRoot: string,
  options: GraphPluginOptions,
  preset: FrameworkPreset = resolvePreset(options.framework),
  cache?: DevCache,
): Promise<GenerateResult> {
  const out = path.join(appRoot, "node_modules", CLIENT);
  const gen = path.join(out, "generated");
  const support = path.join(out, "_support"); // stub graph.ts + branded schema.ts for the compiler

  const cg = runCodegen(appRoot, options.schema, cache);
  await writePackageSkeleton({ out, gen, support, cg, preset });

  const discovery = discoverFiles(appRoot, preset, options, cg.schemaModel);
  const analyzed = await analyzeOperations({ discovery, support, schema: cg.schemaModel, options, appRoot, cache });

  // Registered (hand-built) operations join the same map — generated module,
  // persisted manifest/allowlist and devtools treat them like compiled ones.
  if (options.operations) {
    addRegisteredOperations(analyzed.operations, await loadRegisteredOperations(appRoot, options.operations, cg.schemaModel));
  }

  emitGenerated({ gen, out, schema: cg.schemaModel, operations: analyzed.operations, options, preset });
  return analyzed;
}

/**
 * 1. Provision the runtime (@gleanql/client + its @gleanql/core dep) as in-root JS +
 * real .d.ts. Sources come from the glean monorepo's workspace packages when
 * running inside it, or from the INSTALLED packages' shipped `src/` otherwise
 * (stashed before this overwrite — see {@link resolveRuntimeSources}).
 */
async function provisionRuntime(appRoot: string, out: string, clientFrom?: string): Promise<void> {
  const sources = resolveRuntimeSources(appRoot, clientFrom);
  await provisionPackage(sources.core, appRoot, "@gleanql/core");
  fs.rmSync(out, { recursive: true, force: true });
  await transpileDir(sources.client, path.join(out, "src"));
  emitDeclarations(appRoot, sources);
}

/** 2. Codegen from the SDL → branded types, the schema model (source + evaluated), the graph stub. */
function runCodegen(appRoot: string, schemaPath: string, cache?: DevCache): Codegen {
  const sdl = fs.readFileSync(path.join(appRoot, schemaPath), "utf8");
  // The SDL is static within a dev session — route edits never touch it. Reuse
  // the (expensive on large schemas) codegen output when the SDL is byte-identical.
  if (cache?.codegen && cache.codegen.sdl === sdl) return cache.codegen.result;
  const introspection = introspectionFromSchema(buildSchema(sdl)).__schema as unknown as IntrospectionSchema;
  const schemaModelSrc = generateSchemaModel(introspection);
  const result: Codegen = {
    introspection,
    typesSrc: generateTypes(introspection),
    schemaModelSrc,
    graphStubSrc: generateGraph(introspection),
    schemaModel: evalSchemaModel(schemaModelSrc),
  };
  if (cache) cache.codegen = { sdl, result };
  return result;
}

/**
 * 3. Write the package skeleton — types first (so the compiler can resolve `@gleanql/client`),
 * the evaluated schema model, generated-module placeholders, the typed barrel, the
 * `package.json` exports, and the compiler's support dir. Operations are filled in step 6.
 */
async function writePackageSkeleton(args: {
  out: string;
  gen: string;
  support: string;
  cg: Codegen;
  preset: FrameworkPreset;
}): Promise<void> {
  const { out, gen, support, cg, preset } = args;
  fs.mkdirSync(gen, { recursive: true });
  fs.writeFileSync(path.join(gen, "schema.d.ts"), cg.typesSrc);
  fs.writeFileSync(path.join(gen, "schema.js"), "// types-only module\nexport {};\n");
  await esbuild.build({
    stdin: { contents: cg.schemaModelSrc, loader: "ts", resolveDir: gen },
    outfile: path.join(gen, "schema-model.js"),
    format: "esm",
    platform: "neutral",
    logLevel: "warning",
  });
  fs.writeFileSync(path.join(gen, "operations.js"), "export {};\n"); // placeholder (filled in step 6)
  fs.writeFileSync(path.join(gen, "index.js"), "export {};\n"); // placeholder
  fs.writeFileSync(path.join(out, "index.js"), 'export * from "./src/index.js";\n'); // runtime-only for the compile step
  fs.writeFileSync(path.join(out, "index.d.ts"), genIndexDts(cg.introspection, cg.schemaModel));
  fs.writeFileSync(
    path.join(out, "package.json"),
    JSON.stringify({ name: CLIENT, type: "module", exports: subpathExports(preset) }, null, 2) + "\n",
  );
  fs.mkdirSync(support, { recursive: true });
  fs.writeFileSync(path.join(support, "schema.ts"), cg.typesSrc);
  fs.writeFileSync(path.join(support, "graph.ts"), cg.graphStubSrc);
}

/** The package's subpath exports: always-present entrypoints + the preset's extras. */
function subpathExports(preset: FrameworkPreset): Record<string, SubpathExport> {
  return {
    ".": { types: "./index.d.ts", default: "./index.js" },
    "./schema": { types: "./generated/schema.d.ts", default: "./generated/schema.js" },
    // Client-safe entrypoints (no request-scoped accessor → no framework import):
    "./runtime": { types: "./src/index.d.ts", default: "./src/index.js" },
    "./operations": { types: "./generated/operations.d.ts", default: "./generated/operations.js" },
    // Generated client glue (hydration + useGlean + refresh) — zero app boilerplate.
    "./client": { types: "./generated/client.d.ts", default: "./generated/client.js" },
    // The test harness with the schema baked in (createTestGraph / mocks).
    "./testing": { types: "./generated/testing.d.ts", default: "./generated/testing.js" },
    // Framework-specific extras (e.g. rwsdk's RSC `./server` glue).
    ...preset.extraExports?.(),
  };
}

/**
 * 4. Decide which files to analyze. Routes are discovered, not hand-listed: a route is
 * any file that calls a `graph` root (an explicit `routes` array overrides discovery).
 * Selector-hook islands (`useMutation`/`useSubscription`) compile to standalone ops but
 * are usually `"use client"` and open no query root, so they're discovered separately —
 * every file with such a call must be analyzed exactly once.
 */
function discoverFiles(
  appRoot: string,
  preset: FrameworkPreset,
  options: GraphPluginOptions,
  schema: SchemaModel,
): Discovery {
  const allFiles = listTsx(path.join(appRoot, preset.appDir));
  const rootFields = Object.keys(schema.getType(schema.queryType)?.fields ?? {});
  const routeFiles = options.routes?.length
    ? options.routes.map((rel) => path.join(appRoot, rel))
    : allFiles.filter((f) => isRouteFile(fs.readFileSync(f, "utf8"), rootFields));

  const routeFileSet = new Set(routeFiles.map((f) => path.resolve(f)));
  const hookNames = [
    ...(schema.mutationType ? ["useMutation"] : []),
    ...(schema.subscriptionType ? ["useSubscription"] : []),
  ];
  const hookProbe = hookNames.length ? new RegExp(`\\b(?:${hookNames.join("|")})\\s*\\(`) : undefined;
  const hookFiles = hookProbe
    ? allFiles.filter((f) => !routeFileSet.has(path.resolve(f)) && hookProbe.test(fs.readFileSync(f, "utf8")))
    : [];

  return { allFiles, analyzeFiles: [...routeFiles, ...hookFiles], appPaths: readAppPaths(appRoot) };
}

/**
 * 5. Build ONE program over all files and analyze each entry against it (instead of a
 * fresh program per route — O(routes × files) → one). Collects the operations and the
 * route→component map (query ops only — mutation/subscription ops have no route
 * component to wrap), then reports diagnostics.
 */
async function analyzeOperations(args: {
  discovery: Discovery;
  support: string;
  schema: SchemaModel;
  options: GraphPluginOptions;
  appRoot: string;
  cache?: DevCache;
}): Promise<GenerateResult> {
  const { discovery, support, schema, options, appRoot, cache } = args;
  const { backend, ast } = await selectBackend(
    options.backend,
    {
      fileNames: [...discovery.allFiles],
      supportDir: support,
      paths: discovery.appPaths?.paths,
      baseUrl: discovery.appPaths?.baseUrl,
    },
    cache?.backendSession,
  );

  const operations: Record<string, OperationArtifact> = {};
  const routeComponents: RouteComponents = new Map();
  const diagnostics: string[] = [];
  try {
    for (const fileName of discovery.analyzeFiles) {
      const result = analyzeFile({ fileName, backend, schema, ast });
      for (const op of result.operations) {
        operations[op.name] = op;
        // Only query routes are wrapped with the RSC hydrator; mutation/subscription
        // ops are standalone and have no route component to transform.
        if (op.kind !== "query") continue;
        // `op.name === route component name`, `op.source === route file` (analyzer).
        const key = path.resolve(op.source ?? fileName);
        let names = routeComponents.get(key);
        if (!names) routeComponents.set(key, (names = new Set()));
        names.add(op.name);
      }
      for (const d of result.diagnostics) {
        diagnostics.push(`${path.relative(appRoot, fileName)}${d.line ? `:${d.line}` : ""} [${d.code}] ${d.message}`);
      }
    }
  } finally {
    backend.dispose?.();
  }

  reportDiagnostics(diagnostics, options.strict);
  return { operations, routeComponents, diagnostics };
}

/** The type engine: the experimental Go-native `tsgo`, or the in-process `typescript` (default + fallback). */
async function selectBackend(
  kind: GraphPluginOptions["backend"],
  backendOpts: BackendOptions,
  session?: BackendSession,
): Promise<{ backend: GraphCompilerBackend; ast?: AstFacade }> {
  if (kind === "tsgo") {
    try {
      // tsgo runs its own process; it doesn't share the in-process incremental session.
      return await createTsgoBackend(backendOpts);
    } catch (err) {
      console.warn(`@gleanql/vite: tsgo backend unavailable, falling back to "typescript" — ${(err as Error).message}`);
    }
  }
  return { backend: createBackend("typescript", backendOpts, session) };
}

/**
 * Surface unsupported-pattern diagnostics: those reads won't be in the operation, so
 * they'd silently miss at runtime. Warn by default; `strict` fails the build.
 */
function reportDiagnostics(diagnostics: readonly string[], strict: boolean | undefined): void {
  if (diagnostics.length === 0) return;
  const report = `@gleanql/vite: ${diagnostics.length} compiler diagnostic(s):\n${diagnostics.map((d) => `  ${d}`).join("\n")}`;
  if (strict) throw new Error(report);
  console.warn(report);
}

/**
 * 6. Fill in the generated modules + the top-level barrel. Framework-specific glue
 * (client, optional server) comes from the preset; the accessor uses its request scope.
 */
function emitGenerated(args: {
  gen: string;
  out: string;
  schema: SchemaModel;
  operations: Record<string, OperationArtifact>;
  options: GraphPluginOptions;
  preset: FrameworkPreset;
}): void {
  const { gen, out, schema, operations, options, preset } = args;
  const emitCtx = {
    schemaModel: schema,
    operations,
    endpoint: options.endpoint ?? "/graphql",
    maxCacheRecords: options.maxCacheRecords,
    persisted: options.persisted,
    gcKeepPages: options.gcKeepPages,
    masking: options.masking,
  };
  // The skeleton wrote the FULL schema model (step 3) so the package resolves
  // during compilation; now that the operations are known, replace it with the
  // runtime-reachable subset. Everything the runtime asks the schema —
  // identity keys, proxy navigation, `usePaginated` trails — is bounded by
  // the compiled selections, so the full model never needs to ship.
  fs.writeFileSync(
    path.join(gen, "schema-model.js"),
    renderSlimSchemaModelJs(slimRuntimeSchema(schema, operations)),
  );

  const readMask = options.masking ? renderReadMask(operations, schema) : undefined;
  fs.writeFileSync(path.join(gen, "operations.js"), genOperationsJs(operations, readMask));
  fs.writeFileSync(path.join(gen, "operations.d.ts"), genOperationsDts(options.masking));
  // The persisted-operations manifest (sha256 → document): the interop artifact for
  // a SEPARATELY-deployed GraphQL server's allowlist. A same-deploy server can skip
  // it and feed the `operations` map to createPersistedResolver directly.
  fs.writeFileSync(path.join(gen, "persisted.json"), genPersistedManifest(operations));

  const client = preset.emitClientGlue(emitCtx);
  fs.writeFileSync(path.join(gen, "client.js"), client.js);
  fs.writeFileSync(path.join(gen, "client.d.ts"), client.dts);

  fs.writeFileSync(path.join(gen, "testing.js"), genTestingJs());
  fs.writeFileSync(path.join(gen, "testing.d.ts"), genTestingDts());

  const server = preset.emitServerGlue?.(emitCtx);
  if (server) {
    fs.writeFileSync(path.join(gen, "server.js"), server.js);
    fs.writeFileSync(path.join(gen, "server.d.ts"), server.dts);
  }

  fs.writeFileSync(path.join(gen, "index.js"), genGeneratedJs(schema, operations, preset.requestScope));
  fs.writeFileSync(path.join(out, "index.js"), 'export * from "./src/index.js";\nexport * from "./generated/index.js";\n');
}
