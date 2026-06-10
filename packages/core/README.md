# @gleanql/core

The operation foundation for [Glean](https://github.com/gleanql/gleanql) —
GraphQL without writing GraphQL. This package owns everything between "a set
of field reads" and "a GraphQL document":

- **Operation IR** — the intermediate representation the compiler emits
  instead of strings.
- **Merger** — dedupes selections by canonical path, injects identity fields
  (`__typename`/`id`), aliases argument conflicts, orders deterministically.
- **Printer** — IR → GraphQL text, with opt-in named-fragment extraction for
  repeated sub-selections.
- **Schema model** — the minimal schema knowledge the compiler and runtime
  share (`defineSchema`).
- **`buildQuery`** — the fluent escape hatch for hand-authoring operations
  (register them through the vite plugin to get them typed and allowlisted).
- **`hashDocument`** — dependency-free sha-256; the persisted-operation id.

You normally don't install this directly — it comes with
[`@gleanql/client`](https://github.com/gleanql/gleanql/tree/main/packages/client)
and [`@gleanql/vite`](https://github.com/gleanql/gleanql/tree/main/packages/vite).

## Docs

Full documentation lives in the [Glean repo](https://github.com/gleanql/gleanql).

MIT
