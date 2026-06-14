import * as esbuild from "esbuild";
import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * Read the app's `tsconfig.json` `paths` (e.g. `"@/*": ["./src/*"]`), resolved to
 * absolute, so the compiler can follow route imports written against the app's
 * aliases — not only relative paths. Returns `undefined` when there are no paths.
 * Uses the TypeScript parser so JSONC comments and `extends` are handled.
 */
export function readAppPaths(
  appRoot: string,
): { paths: Record<string, string[]>; baseUrl: string } | undefined {
  const configPath = ts.findConfigFile(appRoot, ts.sys.fileExists, "tsconfig.json");
  if (!configPath) return undefined;
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error) return undefined;
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
  const { paths, baseUrl } = parsed.options;
  if (!paths || Object.keys(paths).length === 0) return undefined;
  // tsc resolves `paths` relative to baseUrl, defaulting to the tsconfig dir.
  const base = baseUrl ?? path.dirname(configPath);
  const abs: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(paths)) {
    abs[key] = values.map((v) => path.resolve(base, v));
  }
  return { paths: abs, baseUrl: base };
}

/** Walk up from the app root to the monorepo root (where pnpm-workspace.yaml lives). */
export function findRepoRoot(start: string): string {
  let dir = start;
  for (;;) {
    if (fs.existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("@gleanql/vite: monorepo root (pnpm-workspace.yaml) not found above " + start);
    dir = parent;
  }
}

/** Where the runtime packages' `.ts` SOURCES live for this app. */
export interface RuntimeSources {
  readonly core: string;
  readonly client: string;
  /** `workspace` = the glean monorepo itself; `installed` = published packages from node_modules. */
  readonly mode: "workspace" | "installed";
}

/**
 * Locate the `@gleanql/core` + `@gleanql/client` sources to provision from.
 *
 * - **Workspace mode** (this monorepo's examples/docs): the workspace packages'
 *   `src/` directly.
 * - **Installed mode** (a real app that `npm install`ed the packages): published
 *   packages ship their `src/*.ts`; resolve each package through node and STASH a
 *   version-keyed copy under `node_modules/.glean/` before provisioning replaces
 *   the package with the transpiled tree. The stash is what re-runs read — it
 *   survives both pnpm's store symlinks being swapped for real dirs and npm's
 *   in-place package being overwritten. A version bump reinstalls a pristine
 *   package, which produces a fresh stash.
 */
export function resolveRuntimeSources(appRoot: string, clientFrom?: string): RuntimeSources {
  const repo = tryFindRepoRoot(appRoot);
  if (repo) {
    const core = path.join(repo, "packages", "core", "src");
    const client = path.join(repo, "packages", "client", "src");
    if (fs.existsSync(path.join(client, "index.ts")) && fs.existsSync(path.join(core, "index.ts"))) {
      return { core, client, mode: "workspace" };
    }
  }
  const appManifest = path.join(appRoot, "package.json");
  // @gleanql/client is normally a direct app dependency. When a host package
  // (e.g. a meta-framework) re-exports the accessor and the app doesn't declare
  // @gleanql/client itself, resolve it THROUGH that host — the same transitive
  // route used for @gleanql/core below (pnpm's strict layout hides transitive
  // deps from the app manifest, but Node resolution from the host's realpath'd
  // package.json reaches them).
  const hostRoot = clientFrom ? packageRootOf(appManifest, clientFrom) : undefined;
  const clientRoot =
    packageRootOf(appManifest, "@gleanql/client") ??
    (hostRoot ? packageRootOf(path.join(fs.realpathSync(hostRoot), "package.json"), "@gleanql/client") : undefined);
  // @gleanql/core is usually NOT a direct app dependency — resolve it THROUGH the
  // client package, which declares it.
  const coreRoot =
    packageRootOf(appManifest, "@gleanql/core") ??
    (clientRoot ? packageRootOf(path.join(fs.realpathSync(clientRoot), "package.json"), "@gleanql/core") : undefined);
  const client = installedSource(appRoot, "@gleanql/client", clientRoot);
  const core = installedSource(appRoot, "@gleanql/core", coreRoot);
  if (!core || !client) {
    throw new Error(
      "@gleanql/vite: cannot locate the @gleanql/client and @gleanql/core sources. " +
        "Install @gleanql/client in the app (the packages ship their src/)" +
        (clientFrom ? `, expose it through the configured host package '${clientFrom}',` : ",") +
        " or run inside the glean monorepo." +
        (core ? "" : " Missing: @gleanql/core.") +
        (client ? "" : " Missing: @gleanql/client."),
    );
  }
  return { core, client, mode: "installed" };
}

function tryFindRepoRoot(start: string): string | undefined {
  try {
    return findRepoRoot(start);
  } catch {
    return undefined;
  }
}

/** The stash slot for a package's pristine sources, keyed by version. */
function stashDir(appRoot: string, name: string, version: string): string {
  return path.join(appRoot, "node_modules", ".glean", `${name.replace("/", "+")}@${version}`);
}

/**
 * The `src/` to provision a package from: the pristine installed package
 * (stashed aside first — provisioning is about to replace it), else the newest
 * existing stash (a previous run already replaced the package; an upgrade
 * reinstalls a pristine copy, which re-stashes).
 */
function installedSource(appRoot: string, name: string, root: string | undefined): string | undefined {
  if (root) {
    // realpath escapes pnpm's symlink into the store.
    const real = fs.realpathSync(root);
    const src = path.join(real, "src");
    if (fs.existsSync(path.join(src, "index.ts"))) {
      const manifest = JSON.parse(fs.readFileSync(path.join(real, "package.json"), "utf8")) as { version?: string };
      const stashed = path.join(stashDir(appRoot, name, manifest.version ?? "0"), "src");
      if (!fs.existsSync(path.join(stashed, "index.ts"))) {
        fs.mkdirSync(stashed, { recursive: true });
        for (const f of fs.readdirSync(src).filter((f) => f.endsWith(".ts"))) {
          fs.copyFileSync(path.join(src, f), path.join(stashed, f));
        }
      }
      return stashed;
    }
  }

  const glean = path.join(appRoot, "node_modules", ".glean");
  const prefix = `${name.replace("/", "+")}@`;
  if (!fs.existsSync(glean)) return undefined;
  const newest = fs
    .readdirSync(glean)
    .filter((d) => d.startsWith(prefix))
    .map((d) => path.join(glean, d))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
  const reused = newest ? path.join(newest, "src") : undefined;
  return reused && fs.existsSync(path.join(reused, "index.ts")) ? reused : undefined;
}

/** The directory holding a package's package.json, resolved from `fromManifest`'s location. */
function packageRootOf(fromManifest: string, name: string): string | undefined {
  try {
    // Resolve the entry (`"."` is always exported) and walk up to package.json —
    // published exports maps don't expose `./package.json` for direct resolution.
    const req = createRequire(fromManifest);
    let dir = path.dirname(req.resolve(name));
    for (;;) {
      if (fs.existsSync(path.join(dir, "package.json"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) return undefined;
      dir = parent;
    }
  } catch {
    return undefined;
  }
}

/** Transpile every `.ts` in `srcDir` to ESM `.js` in `outDir`, preserving import specifiers. */
export async function transpileDir(srcDir: string, outDir: string): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });
  await esbuild.build({
    entryPoints: fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts")).map((f) => path.join(srcDir, f)),
    outdir: outDir,
    format: "esm",
    platform: "neutral",
    logLevel: "warning",
  });
}

/**
 * Provision a @gleanql package into the app's node_modules as real, in-root JS
 * (RedwoodSDK's directive scanner requires modules inside the app root).
 * `srcDir` must live OUTSIDE the destination (a workspace package or a stash) —
 * the destination is wiped first.
 */
export async function provisionPackage(srcDir: string, appRoot: string, name: string): Promise<void> {
  const dest = path.join(appRoot, "node_modules", name);
  fs.rmSync(dest, { recursive: true, force: true });
  await transpileDir(srcDir, path.join(dest, "src"));
  fs.writeFileSync(
    path.join(dest, "package.json"),
    JSON.stringify({ name, type: "module", main: "./src/index.js", types: "./src/index.d.ts" }) + "\n",
  );
}

/**
 * Emit real `.d.ts` for the @gleanql runtime packages into the provisioned tree, so
 * consumers get full types (not a hand-curated subset). One program per package
 * (their source dirs may be unrelated locations — workspace packages or stashes),
 * each mapped `srcDir → node_modules/<name>/src` so declarations land beside the
 * transpiled JS. Every module is a root, not just index.ts: the generated glue
 * deep-imports modules index doesn't re-export (e.g. `../src/glue-client.js`).
 */
export function emitDeclarations(appRoot: string, sources: RuntimeSources): void {
  // Core first: the client's program resolves `@gleanql/core` through core's
  // ALREADY-EMITTED declarations — never its .ts sources. Source files outside a
  // program's rootDir get emitted beside themselves (TS's common-root fallback),
  // which would scribble .d.ts into the source/stash tree.
  const emittedCoreIndex = path.join(appRoot, "node_modules", "@gleanql", "core", "src", "index.d.ts");
  const packages = [
    { name: "@gleanql/core", srcDir: sources.core, paths: undefined },
    { name: "@gleanql/client", srcDir: sources.client, paths: { "@gleanql/core": [emittedCoreIndex] } },
  ];
  for (const { name, srcDir, paths: pathsMap } of packages) {
    const rootNames = fs.readdirSync(srcDir).filter((f) => f.endsWith(".ts")).map((f) => path.join(srcDir, f));
    const program = ts.createProgram(rootNames, {
      declaration: true,
      emitDeclarationOnly: true,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
      skipLibCheck: true,
      strict: false,
      rootDir: srcDir,
      outDir: path.join(appRoot, "node_modules", name, "src"),
      baseUrl: appRoot,
      ...(pathsMap ? { paths: pathsMap } : {}),
    });
    program.emit();
  }
}

/** All `.ts(x)` files under a directory (the route program for the compiler). */
export function listTsx(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTsx(p));
    else if (/\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}
