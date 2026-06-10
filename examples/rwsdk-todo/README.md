# Glean · Todo (RedwoodSDK)

A real [RedwoodSDK](https://rwsdk.com) app on Cloudflare Workers, with **Glean** as the
data layer. A working TodoMVC: add / toggle / delete / clear, filters, and persistence
— no hand-written GraphQL queries anywhere.

```bash
pnpm --filter @example/rwsdk-todo dev
```

## What it shows

It uses the RedwoodSDK stack to its fullest, and Glean for every read and write:

- **Persistence — a SQLite Durable Object.** The data lives in `rwsdk/db`'s
  `SqliteDurableObject`, queried with Kysely (`src/db`). It survives reloads and
  redeploys; the migration runs lazily inside the DO on first access.
- **GraphQL over the DB.** A tiny graphql-js executor (`src/graphql/executor.ts`)
  resolves straight out of Kysely. This is the only thing behind Glean's adapter.
- **Glean for the UI.** `@gleanql/vite` compiles `schema.graphql` into the typed `glean`
  accessor + operations:
  - the route (`TodoPage`, RSC) opens `glean.board()` — that's all the data wiring a
    page needs; the read is preloaded and hydrated;
  - the `TodoApp` island reads the live list off `useGlean()` and writes through
    compile-time `useMutation` selectors (`(m, vars) => m.addTodo(vars).id`). A toggle
    returns the entity, so it normalizes into the cache and the row flips in place; an
    add/remove changes membership, so it `refresh()`es the list afterward.
- **RSC + islands.** Server-rendered first paint (the page reads the list and passes it
  as a prop), interactive bits in one `"use client"` island, zero graph glue in app
  code — everything graph-related is generated into `node_modules/@gleanql/client`.

## Layout

```
schema.graphql              the Glean schema (board → todos, the mutations)
src/db/                     the SQLite Durable Object + migrations + Kysely client
src/graphql/executor.ts     graphql-js resolvers over the DB (Glean's adapter)
src/worker.tsx              defineApp: the / route + /graphql endpoint + the DO export
src/app/pages/TodoPage.tsx  the RSC route (opens `glean.board()`)
src/app/components/TodoApp.tsx  the interactive island (useGlean + useMutation)
```
