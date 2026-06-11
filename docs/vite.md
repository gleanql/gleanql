---
title: @gleanql/vite
group: Packages
order: 8
---

# `@gleanql/vite`

This package is the build plugin, and the only build wiring an app needs. It generates the schema-specific runtime into the `@gleanql/client` package the app installs. That runtime is the `glean` accessor, the branded types, and the compiled operations. App code therefore imports everything from `@gleanql/client`.

## Usage

Configuration is one line in `vite.config.mts` — the schema alone. Routes are discovered automatically, so there's nothing to keep in sync as pages come and go:

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

A route is any module that calls a `graph` root, such as `glean.product(...)`. That call is the same signal the analyzer uses to mint an operation. Pass an explicit `routes: [...]` array to override discovery — for example with an aliased `glean` import, or to narrow the set.

## What it does on startup

The plugin's `config()` hook runs before RedwoodSDK's directive scan. It does four things:

1. It provisions the `@gleanql/client` runtime into `node_modules` as real, in-root JS, because the scanner requires modules inside the app root. It also emits real `.d.ts` from source: full runtime types, plus client-safe `./runtime` and `./operations` entrypoints.
2. It runs `@gleanql/codegen` from the schema, producing the `SchemaModel` and branded types.
3. It discovers the route files — those that open a `graph` root, under the preset's `appDir` — and compiles them with `@gleanql/compiler` into operations. The build constructs **one** `ts.Program` over all files and analyzes each route against it, via `analyzeFile` and a shared backend. It does not recreate a full program per route; O(routes × files) program builds become one. The type engine is selectable via `backend`: in-process `typescript` by default, or the experimental Go-native `tsgo`.
4. It writes the generated `glean` accessor, types, and `operations` into `@gleanql/client/generated`, plus a barrel and `package.json` `exports`. The schema model it ships there is the **runtime subset**: only the types/fields reachable from the compiled selections (plus identity fields and leaf stubs). Everything the runtime asks the schema — normalization keys, proxy navigation, `usePaginated` trails — is bounded by the compiled operations, so the full schema never rides into the app bundle: Shopify's Admin API (~3,000 types, ~1MB of model source) shrinks to a few KB.

As a result, `import { glean } from "@gleanql/client"` resolves by ordinary node resolution. No tsconfig paths, no alias.

## Plugin options

`glean({ … })` takes the schema plus a few optional knobs (`GraphPluginOptions`, `src/types.ts`):

| Option | Default | What it does |
| --- | --- | --- |
| `schema` | — | path to the `.graphql` SDL, relative to the app root (required). |
| `routes?` | auto-discover | explicit route file list (relative to the app root) to override discovery. |
| `endpoint?` | `"/graphql"` | URL the generated client POSTs to for client-side refetch. |
| `framework?` | `"rwsdk"` | framework binding — a built-in name or a custom `FrameworkPreset`. |
| `backend?` | `"typescript"` | type engine used to compile routes (see below). |
| `maxCacheRecords?` | unbounded | LRU cap on the long-lived client cache. Opt-in: enable it only with a real `fetchMissing`, because an evicted record re-read otherwise resolves to `undefined`. |
| `strict?` | `false` | fail the build on any compiler diagnostic (unsupported pattern). When off, diagnostics are logged as warnings. |
| `persisted?` | `false` | persisted-operation mode. The generated client sends operations **by sha-256 hash** (`extensions.persistedQuery.sha256Hash`, the APQ wire shape), never by document. Pair the server with `createPersistedResolver(operations)` in the same deploy, or sync the emitted `generated/persisted.json` manifest to it. Live in `examples/rwsdk-real`. |
| `gcKeepPages?` | off | staleness-aware GC. On each navigation, collect cache records that are *unretained AND untouched for N page generations*. Unset means no automatic collection: unretained alone is not a reason to drop valid data, since back-nav should hit a warm cache. `maxCacheRecords` bounds capacity; this bounds staleness. |
| `masking?` | `false` | dev READ-MASKING. Warns when a component reads a `Type.field` outside its own compiled read-map — it renders data another component fetched, which goes stale/missing when that component changes. This is Relay's masking discipline as a dev warning, warned once per pair. Enable in dev only, e.g. `masking: process.env.NODE_ENV !== "production"`. |
| `operations?` | — | REGISTERED operations: a module whose exports are hand-built `buildQuery(...)` IR — the escape hatch for shapes the compiler can't extract. The build runs the module, then prints and hashes each export. They ship like compiled operations: same generated map, persisted allowlist, devtools. Execute with `runOperation(name, variables)`. |

## Devtools (`/__glean`) & live recompilation

In dev, the plugin serves `/__glean`. For every compiled operation, the page shows:

- the document
- the persisted hash
- size stats, with large-operation warnings
- the per-component **read-map tree**

It also shows any compiler diagnostics from the last generate. Everything is compile-time static, so the overlay is the complete, exact picture of what the app can put on the wire.

Editing is live. The plugin watches your route files, the schema, and the registered-operations module. Adding a field read **recompiles the operation immediately**, with no server restart. The plugin then invalidates the module graphs and reloads the page with the new data shape.

Every build emits `generated/persisted.json`: a sorted `{ "<sha256>": "<document>" }` manifest. The manifest is the sync artifact for a separately-deployed GraphQL server's allowlist. Persisted mode doesn't change the emission — it makes the client *use* the hashes.

## Type-check backend (`typescript` / `tsgo`)

Route analysis sends every type/symbol question through the [backend seam](architecture.md). The engine is therefore swappable behind one option:

```tsx
// default — the in-process TypeScript compiler
glean({ schema })

// experimental Go-native engine
glean({ schema, backend: "tsgo" })
```

- **`"typescript"` (default).** The in-process compiler: a real `ts.Program` + `TypeChecker`, built once over all files. This is the [single shared program](architecture.md).
- **`"tsgo"` (experimental).** The Go-native engine, built on `@typescript/native-preview` (`createTsgoBackend` in `packages/compiler/src/tsgo`). It type-checks much faster on large route sets, but it is *pre-release*. The dependency is optional and dynamically imported. If it can't be resolved — e.g. the platform binary doesn't resolve from a bundled plugin under some pnpm layouts — the plugin emits a `console.warn` and **falls back to `"typescript"`**. A build never breaks over it. Selection + fallback live in `src/generate.ts`.

## Framework presets

Everything framework-specific lives behind a **`FrameworkPreset`** (`src/types.ts` + `src/presets/`). The core pipeline (`generate.ts`/`index.ts`) is neutral and delegates. Adding a framework is a new preset, not a new branch.

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

- **RedwoodSDK (`"rwsdk"`, default).** This preset targets RSC. Its `requestScope` reads `requestInfo.ctx`. A `transformRoute` auto-injects a `<GraphHydrate />` server component around route components. The preset emits a `./server` entry plus a `"use client"` client glue.
- **React Router 7 (`"react-router"`).** This preset is isomorphic, not RSC. Its client glue is *not* `"use client"` and shares the app's scope, with no private singleton. There is no server glue and no route transform. The accessor points at the app's universal scope module (`requestScope: { import: "activeGraph", from }`).

The `requestScope` is the only seam `@gleanql/client` itself cares about. It is otherwise framework agnostic. For the custom form, `@gleanql/client` ships a `GraphScope` the accessor resolves from. On the server, a server-only module attaches an `AsyncLocalStorage` via `GraphScope.attachAls(als)` to isolate concurrent requests. The client uses the same scope as a singleton.

## Generated glue: thin shims over typed factories

The runtime glue is **not** authored as template strings. The real, typed, unit-tested logic lives in `@gleanql/client` source: `createGraphClient` (`src/glue-client.ts`) and `createGraphServer` (`src/glue-server.ts`). A preset's `emitClientGlue` / `emitServerGlue` emit ~6-line config shims. The shims call those factories with the baked schema + operations + endpoint, and re-export the public surface:

- **`@gleanql/client/client`** calls `createGraphClient` and re-exports `useGlean` / `refresh` / `hydrate` / `GraphHydrator`.
- **`@gleanql/client/server`** calls `createGraphServer` and re-exports `GraphHydrate` / `withGraphHydration`.

The unified `createGraphClient` serves *both* hydration models. Under RSC it omits a shared scope: a private singleton, fed by the auto-injected `<GraphHydrator>`. For isomorphic SSR it takes the app's shared scope, and the host calls `hydrate(payload)` with loader data. The public API — the named exports above — is unchanged. Only the authoring moved from strings into source.

## Build

The package is authored in TypeScript (`src/{index,generate,emit,render,provision,types}.ts`) and bundled with **tsdown**. The build tools `@gleanql/codegen`/`compiler`/`core` are bundled in. `esbuild`/`graphql`/`typescript` stay external. The pure generators (`render`, `emit`) are unit-tested. The glue logic the shims call — `createGraphClient`/`createGraphServer` in `@gleanql/client` — is tested at the source, not as emitted strings.

---

Framework integrations: [RedwoodSDK](rwsdk.md) (RSC) · [React Router](react-router.md) (isomorphic). The runtime side: `@gleanql/client`.
