# GleanQL starter

The minimal GleanQL app: one schema, one route, one island. Copy this directory
to start a project.

```bash
pnpm install
pnpm dev      # localhost:5173 — and /__glean for the compiled operations
```

What's here:

| File | Why |
|---|---|
| `schema.graphql` | The only input the build needs |
| `vite.config.mts` | `glean({ schema })` — the only GleanQL wiring |
| `src/worker.tsx` | The RedwoodSDK app: a `/graphql` endpoint + one preloaded route |
| `src/graphql.ts` | A tiny in-memory graphql-js executor behind the adapter seam |
| `src/app/pages/NotesPage.tsx` | Opens the `notes` root — the island's reads define the fields |
| `src/app/components/Notes.tsx` | The island: warm `useGlean()` reads + an optimistic `useMutation` insert |

There is no committed generated code: the build provisions the typed accessor,
operations, and runtime into `node_modules/@gleanql/client`.

Swap `src/graphql.ts` for your real data source — a database (see
`examples/rwsdk-todo` for a SQLite Durable Object) or a remote GraphQL API.
