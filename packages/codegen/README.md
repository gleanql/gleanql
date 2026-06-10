# @gleanql/codegen

The schema generator for [Glean](https://github.com/gleanql/gleanql) — GraphQL
without writing GraphQL. From a GraphQL schema (SDL or introspection) it
generates:

- the **schema model** the compiler and runtime share,
- **branded TypeScript types** for every schema type — so API drift (a
  removed field, a tightened nullability) becomes a type error in your
  components,
- the typed **`glean` accessor** your components read from.

You normally don't install this directly — the
[`@gleanql/vite`](https://github.com/gleanql/gleanql/tree/main/packages/vite)
plugin runs it on every build from your `schema.graphql`.

## Docs

Full documentation lives in the [Glean repo](https://github.com/gleanql/gleanql).

MIT
