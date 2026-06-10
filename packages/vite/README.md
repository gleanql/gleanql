# @gleanql/vite

The build plugin for [Glean](https://github.com/gleanql/gleanql) — GraphQL
without writing GraphQL. This is the only build wiring an app needs:

```ts
// vite.config.ts
import { glean } from "@gleanql/vite";

export default defineConfig({
  plugins: [glean({ schema: "./schema.graphql" }), redwood()],
});
```

On every build and dev start it generates the schema-specific runtime into
`@gleanql/client`: the typed `glean` accessor, branded schema types, the
compiled operations (one per route, extracted from your components' field
reads), and the persisted-operation manifest. In dev it also serves the
**`/__glean`** devtools page and recompiles operations live as you edit.

## Options

| Option | Default | What it does |
|---|---|---|
| `schema` | — | path to your `.graphql` SDL (required) |
| `framework` | `"rwsdk"` | `"rwsdk"`, `"react-router"`, or a custom preset |
| `endpoint` | `"/graphql"` | URL the client POSTs to |
| `persisted` | `false` | send operations by sha-256 hash; pair with `createPersistedResolver` |
| `operations` | — | a module of hand-built `buildQuery` operations to register |
| `gcKeepPages` | off | staleness-aware cache GC on navigation |
| `masking` | `false` | dev warning when a component reads outside its compiled read-map |
| `maxCacheRecords` | unbounded | LRU cap on the client cache |
| `strict` | `false` | fail the build on any compiler diagnostic |
| `backend` | `"typescript"` | type engine (`"tsgo"` = experimental Go-native) |

## Docs

Full documentation lives in the [Glean repo](https://github.com/gleanql/gleanql)
— run `pnpm docs` there, or start with the Get Started guide.

MIT
