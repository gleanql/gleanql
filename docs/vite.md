---
title: @gleanql/vite
group: Packages
order: 8
---

# `@gleanql/vite`

The build plugin — the only build wiring an app needs. It generates the schema-specific runtime (the `glean` accessor, branded types, compiled operations) into the `@gleanql/client` package the app installs, so app code imports everything from `@gleanql/client`.

## Usage

One line in `vite.config.mts` — just the schema. Routes are discovered automatically (any file that opens a `graph` root), so there's nothing to keep in sync as pages come and go:

```tsx
import { defineConfig } from "vite";
import { glean } from "@gleanql/vite";

export default defineConfig({
  plugins: [
    glean({ schema: "schema.graphql" }),
    redwood(),
  ],
});
```

A route is any module that calls a `graph` root — `glean.product(...)` — the same signal the analyzer uses to mint an operation. Pass an explicit `routes: [...]` array to override discovery (e.g. an aliased `glean` import, or to narrow the set).

## What it does on startup

The plugin's `config()` hook runs before RedwoodSDK's directive scan and:

1. provisions the `@gleanql/client` runtime into `node_modules` as real, in-root JS (the scanner requires modules inside the app root), with real `.d.ts` emitted from source — full runtime types, plus client-safe `./runtime` and `./operations` entrypoints;
2. runs `@gleanql/codegen` from the schema → `SchemaModel` + branded types;
3. discovers the route files (those that open a `graph` root, under the preset's `appDir`) and compiles them with `@gleanql/compiler` → operations. It builds **one** `ts.Program` over all files and analyzes each route against it (`analyzeFile` + a shared backend), instead of recreating a full program per route — turning O(routes × files) program builds into one. The type engine is selectable via `backend` (in-process `typescript` by default; experimental Go-native `tsgo`);
4. writes the generated `glean` accessor, types, and `operations` into `@gleanql/client/generated`, plus a barrel and `package.json` `exports`.

So `import { glean } from "@gleanql/client"` resolves by ordinary node resolution — no tsconfig paths, no alias.

## Plugin options

`glean({ … })` takes the schema plus a few optional knobs (`GraphPluginOptions`, `src/types.ts`):

| Option | Default | What it does |
| --- | --- | --- |
| `schema` | — | path to the `.graphql` SDL, relative to the app root (required). |
| `routes?` | auto-discover | explicit route file list (relative to the app root) to override discovery. |
| `endpoint?` | `"/graphql"` | URL the generated client POSTs to for client-side refetch. |
| `framework?` | `"rwsdk"` | framework binding — a built-in name or a custom `FrameworkPreset`. |
| `backend?` | `"typescript"` | type engine used to compile routes (see below). |
| `maxCacheRecords?` | unbounded | LRU cap on the long-lived client cache. Opt-in (only enable with a real `fetchMissing` — an evicted record re-read otherwise resolves to `undefined`). |
| `strict?` | `false` | fail the build on any compiler diagnostic (unsupported pattern). Off ⇒ diagnostics are logged as warnings. |
| `persisted?` | `false` | persisted-operation mode: the generated client sends operations **by sha-256 hash** (`extensions.persistedQuery.sha256Hash`, the APQ wire shape), never by document. Pair the server with `createPersistedResolver(operations)` (same deploy) or sync the emitted `generated/persisted.json` manifest to it. Live in `examples/rwsdk-real`. |
| `gcKeepPages?` | off | staleness-aware GC: on each navigation, collect cache records that are *unretained AND untouched for N page generations*. Unset = no automatic collection — unretained alone is not a reason to drop valid data (back-nav should hit a warm cache); `maxCacheRecords` bounds capacity, this bounds staleness. |
| `masking?` | `false` | dev READ-MASKING: warn when a component reads a `Type.field` outside its own compiled read-map — it renders data another component fetched, which goes stale/missing when that component changes (Relay's masking discipline as a dev warning, warned once per pair). Enable in dev only, e.g. `masking: process.env.NODE_ENV !== "production"`. |
| `operations?` | — | REGISTERED operations: a module whose exports are hand-built `buildQuery(...)` IR — the escape hatch for shapes the compiler can't extract. The build runs it, prints + hashes each export, and ships them like compiled operations (same generated map, persisted allowlist, devtools). Execute with `runOperation(name, variables)`. |

## Devtools (`/__glean`) & live recompilation

In dev, the plugin serves `/__glean`: every compiled operation — document, persisted hash, size stats with large-operation warnings, and the per-component **read-map tree** — plus any compiler diagnostics from the last generate. Because everything is compile-time static, the overlay is the complete, exact picture of what the app can put on the wire.

Editing is live: the plugin watches your route files, the schema, and the registered-operations module — adding a field read **recompiles the operation immediately** (no server restart), invalidates the module graphs, and reloads the page with the new data shape.

> [!NOTE]
> In persisted mode every build also emits `generated/persisted.json` — a sorted `{ "<sha256>": "<document>" }` manifest, the sync artifact for a separately-deployed GraphQL server's allowlist. (The manifest is emitted in every build, in fact — persisted mode just makes the client *use* the hashes.)

## Type-check backend (`typescript` / `tsgo`)

Route analysis routes every type/symbol question through the [backend seam](architecture.md), so the engine is swappable behind one option:

```tsx
// default — the in-process TypeScript compiler
glean({ schema })

// experimental Go-native engine
glean({ schema, backend: "tsgo" })
```

- **`"typescript"` (default).** The in-process compiler — a real `ts.Program` + `TypeChecker`, built once over all files (the [single shared program](architecture.md)).
- **`"tsgo"` (experimental).** The Go-native engine (`@typescript/native-preview`, `createTsgoBackend` in `packages/compiler/src/tsgo`) — much faster type-checking on large route sets, but *pre-release*. The dependency is optional and dynamically imported; if it can't be resolved (e.g. the platform binary doesn't resolve from a bundled plugin under some pnpm layouts) the plugin emits a `console.warn` and **falls back to `"typescript"`**, so a build never breaks. Selection + fallback live in `src/generate.ts`.

## Framework presets

Everything framework-specific lives behind a **`FrameworkPreset`** (`src/types.ts` + `src/presets/`). The core pipeline (`generate.ts`/`index.ts`) is neutral and delegates; adding a framework is a new preset, not a new branch.

```tsx
// default — RedwoodSDK (RSC)
glean({ schema })

// React Router 7 (isomorphic SSR — not RSC)
glean({ schema, framework: "react-router" })

// or a custom preset object
glean({ schema, framework: myPreset })
```

A preset owns every framework-specific decision:

| Preset field | What it owns |
| --- | --- |
| `appDir` | source dir scanned for route files (rwsdk `"src"`, RR7 `"app"`). |
| `requestScope` | how the generated `glean` accessor resolves *this request's* runtime. |
| `emitClientGlue` | the `@gleanql/client/client` module (`useGlean`/`refresh` + hydration). |
| `emitServerGlue?` | optional `@gleanql/client/server` glue (an RSC server component). Omit ⇒ none. |
| `transformRoute?` | optional route-module transform (RSC auto-inject). Omit ⇒ no transform runs. |
| `extraExports?` | subpath exports beyond `.`, `./schema`, `./runtime`, `./operations`, `./client`. |

The two built-ins:

- **RedwoodSDK (`"rwsdk"`, default).** RSC. `requestScope` reads `requestInfo.ctx`; a `transformRoute` auto-injects a `<GraphHydrate />` server component around route components; emits a `./server` entry plus a `"use client"` client glue.
- **React Router 7 (`"react-router"`).** Isomorphic, non-RSC. Emits client glue that is *not* `"use client"` and shares the app's scope (no private singleton) — no server glue, no route transform. The accessor points at the app's universal scope module (`requestScope: { import: "activeGraph", from }`).

The `requestScope` is the only seam `@gleanql/client` itself cares about — it is otherwise framework agnostic. For the custom form, `@gleanql/client` ships a `GraphScope` the accessor resolves from; a server-only module attaches an `AsyncLocalStorage` via `GraphScope.attachAls(als)` to isolate concurrent requests, while the client uses the same scope as a singleton.

## Generated glue: thin shims over typed factories

The runtime glue is **not** authored as template strings. The real, typed, unit-tested logic lives in `@gleanql/client` source — `createGraphClient` (`src/glue-client.ts`) and `createGraphServer` (`src/glue-server.ts`). A preset's `emitClientGlue` / `emitServerGlue` emit ~6-line config shims that call those factories with the baked schema + operations + endpoint and re-export the public surface:

- **`@gleanql/client/client`** calls `createGraphClient` and re-exports `useGlean` / `refresh` / `hydrate` / `GraphHydrator`.
- **`@gleanql/client/server`** calls `createGraphServer` and re-exports `GraphHydrate` / `withGraphHydration`.

The unified `createGraphClient` serves *both* hydration models: under RSC it omits a shared scope (a private singleton, fed by the auto-injected `<GraphHydrator>`), and for isomorphic SSR it takes the app's shared scope (the host calls `hydrate(payload)` with loader data). The public API — the named exports above — is unchanged; only the authoring moved from strings into source.

## Build

The package is authored in TypeScript (`src/{index,generate,emit,render,provision,types}.ts`) and bundled with **tsdown** (the build tools `@gleanql/codegen`/`compiler`/`core` are bundled in; `esbuild`/`graphql`/`typescript` stay external). The pure generators (`render`, `emit`) are unit-tested, and the glue logic the shims call (`createGraphClient`/`createGraphServer` in `@gleanql/client`) is tested at the source, not as emitted strings.

---

Framework integrations: [RedwoodSDK](rwsdk.md) (RSC) · [React Router](react-router.md) (isomorphic). The runtime side: `@gleanql/client`.
