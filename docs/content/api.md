---
title: API reference
group: Reference
order: 14
---

# API reference

A condensed index of the main exports per package. See each package page for prose.

## `@gleanql/core`

| Export | Kind | Summary |
| --- | --- | --- |
| `q` | builder | `operation, query, select, field, scalar, inlineFragment, var, literal, enumValue, list, object, args` |
| `mergeSelectionSets(sets, schema, opts?)` | fn | merge contributions on one type |
| `mergeOperations(name, ops, schema)` | fn | merge whole operations at the root |
| `printOperation(op, opts?)` | fn | IR → GraphQL document; `opts.fragments` (off by default) extracts repeated identical sub-selections into named fragments (`{ minUses?, minSelections? }`) |
| `printArgs / printArgValue` | fn | argument printing |
| `canonicalArgs / argAliasSuffix` | fn | dedupe identity & alias suffix |
| `defineSchema(init)` · `SchemaModel` | class/fn | schema model |
| `hashDocument(doc)` · `sha256Hex(s)` | fn | sha-256 hex — the persisted-operation ID (dependency-free, env-agnostic) |
| `renderReadMapTree / summarizeOperation` | fn | devtools |
| `buildQuery(name, vars, build)` | fn | fluent escape hatch |
| `OperationIR, SelectionSet, FieldSelection, ArgValue, OperationArtifact, ReadMap` | types | IR & artifact |

## `@gleanql/compiler`

| Export | Kind | Summary |
| --- | --- | --- |
| `analyzeWithTs({ fileName, supportDir, schema })` | fn | build a TS backend + analyze one file |
| `analyzeFile({ fileName, backend, schema })` | fn | analyze against an existing backend |
| `TsBackend` | class | `GraphCompilerBackend` over `ts.Program` |
| `GraphCompilerBackend` | interface | type/symbol seam |
| `findUseMutationSites(root, ast)` | fn | discover `useMutation` call-sites + their compiled op names (shared by analyzer and build transform; syntactic, checker-free) |
| `AnalyzeResult, Diagnostic, DiagnosticCode, UseMutationSite` | types | analysis output |

## `@gleanql/client` (runtime)

| Export | Kind | Summary |
| --- | --- | --- |
| `GraphRuntime` | class | `readField, seed, seedResult, invalidate, snapshot`; static `hydrate` |
| `GraphCache` | class | normalized + path storage; `recordKey, getField, merge, invalidate, snapshot`; field-level reactivity via `recordVersion / fieldVersion / trackedVersion`; reference-counted retention via `retain / isRetained` (mounted readers retain automatically; LRU eviction skips retained records); staleness-aware collection via `advanceEpoch / gc({ keepEpochs? })` |
| `normalizeValue / seedResult` | fn | result → cache |
| `runMutation(opts)` | fn | server-side mutation engine: execute → normalize result into the cache → `userErrors` + optimistic/rollback + invalidate; returns `MutationResult` (never rejects logical failures) |
| `createMutator(opts)` | fn | bind a set of named mutations to a runtime/adapter → `BoundMutations` |
| `runRoute(args)` | fn | compute variables → execute → seed |
| `createFetchAdapter(opts)` | fn | plain fetch transport (HTTP + SSE subscriptions); `persisted: true` sends operations by sha-256 hash (APQ shape) with a one-shot document retry on `PersistedQueryNotFound` |
| `createPersistedResolver(operations, opts?)` | fn | server-side persisted allowlist: request body → `{ kind: "ok", document }` / `"not-found"` / `"rejected"`; `allowUnpersisted` opts out of rejection |
| `GraphClientEvent` | type | the `onEvent` incident channel: `refresh-error \| operation-error \| mutation-error \| subscription-error \| persisted-retry \| gc` |
| `createGraphWsAdapter({ client, extensions? })` | fn | WebSocket transport over an injected `graphql-ws` client; drives `execute` + `subscribe` |
| `GraphScope / bindScope(als?)` | class/fn | request-scoped runtime; `bindScope` pairs it with the accessor's resolver |
| `GraphClientAdapter, GraphFrameworkAdapter, CompiledOperation, GraphRef, MissingFieldRead/Result` | types | seams & values |
| `MutationResult, UserError, RunMutationOptions, CreateMutatorOptions, BoundMutations` | types | mutation engine values & options |

## `@gleanql/client/client` (generated hooks)

| Export | Kind | Summary |
| --- | --- | --- |
| `useGlean()` | hook | the active graph; re-renders the caller fine-grained — only when a record it read this pass changes |
| `usePaginated(connection, { merge }?)` | hook | → `{ fetchMore, isLoading, error }`; `fetchMore(args)` re-runs the connection's selection and merges the page (default concat, or via `merge`) |
| `useMutation(selector, options?)` | hook | → `[mutate, { isLoading, data, error, userErrors }]` — gqty-style, compile-time selector; `await mutate(vars)` runs the compiled op and folds the result into the cache. Options: `optimistic` (field writes), `optimisticRoots` (list-root membership, auto-rolled-back), `update`, `invalidate`, `onCompleted`/`onError` |
| `useSubscription(selector, options?)` | hook | → `{ data, error }` — gqty-style, compile-time selector; opens the adapter's `subscribe` stream (SSE by default) and folds each push into the cache |
| `refresh(target?)` | fn | refetch the current page operation, a named op, or a component slice (`{ component }`) |
| `runOperation(name, variables?)` | fn | execute a named (compiled or registered) operation; **fully typed** by the generated `GleanOperations` interface (variables AND result shape per name); seeds the normalized cache; rides the persisted hash |
| `appendToRoot(field, entity, { prepend?, at? }?)` | fn | splice an entity into a list root's membership without a refetch; seeds a client-built entity's fields for optimistic UI |
| `removeFromRoot(field, entity)` | fn | remove an entity from a list root's membership without a refetch (inverse of `appendToRoot`) |
| `UseMutationOptions, MutationState, MutationResult, UserError, UsePaginatedOptions, UsePaginatedResult, UseSubscriptionOptions, SubscriptionState` | types | hook options & result shapes |

These are emitted into `@gleanql/client/client` by the vite plugin as thin shims over `createGraphClient`; `useMutation`/`useSubscription`/`usePaginated` are emitted only when the schema/usage warrants.

## `@gleanql/vite`

| Export | Kind | Summary |
| --- | --- | --- |
| `glean({ schema, routes, requestScope? })` | fn | the vite plugin: generates the schema into `@gleanql/client` |
| `GraphPluginOptions` | type | `{ schema; routes?; endpoint?; framework?; backend?; maxCacheRecords?; strict?; persisted?; gcKeepPages?; operations? }` |
| `renderDevtoolsHtml(operations, diagnostics)` | fn | the `/__glean` dev overlay page (served automatically by the plugin in dev) |
| `RequestScope` | type | `"rwsdk" \| { import; from }` — how the accessor finds the active runtime |

---

All exports are re-exported from each package's `src/index.ts`.
