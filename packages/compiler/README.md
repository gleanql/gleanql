# @gleanql/compiler

The static analyzer for [Glean](https://github.com/gleanql/gleanql) — GraphQL
without writing GraphQL. It reads your React components with a real TypeScript
program and turns their field reads into compiled GraphQL operations:

- Follows reads through **JSX props** (across files), **helpers**,
  **`.map`/`.filter`/`.find` callbacks** (inline, destructured, or named
  function references), **conditional components**, **registries**, and
  **`"use client"` islands**.
- Lifts root arguments into **operation variables**, builds the per-component
  **read map** (which drives component-sliced `refresh()` and dev
  read-masking), and handles union narrowing, lazy boundaries, and more.
- Anything it can't follow is a **diagnostic** — the invariant is that the
  compiler may refuse, but it never silently under-fetches.
- Two interchangeable type-check engines: the in-process `typescript` compiler
  (default) and the experimental Go-native `tsgo`.

You normally don't install this directly — the
[`@gleanql/vite`](https://github.com/gleanql/gleanql/tree/main/packages/vite)
plugin drives it.

## Docs

Full documentation (including the golden-case behavior catalog) lives in the
[Glean repo](https://github.com/gleanql/gleanql).

MIT
