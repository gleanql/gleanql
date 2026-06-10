# Contributing to GleanQL

## Getting set up

```bash
pnpm install
pnpm test        # full suite (~420 tests), no build step needed
pnpm typecheck   # every package against one root tsconfig
pnpm bench       # micro-benchmarks (compiler + cache)
pnpm docs        # the docs site at localhost:5173 (markdown lives in docs/)
```

Packages resolve to source (`exports` → `./src`), so tests and examples run
without building. `pnpm build` produces the publishable `dist/` bundles.

## Repository layout

| Path | What it is |
|---|---|
| `packages/core` | Operation IR, merger, printer, schema model |
| `packages/compiler` | The static analyzer (routes → operations) |
| `packages/codegen` | Schema → typed accessor + branded types |
| `packages/client` | The runtime: cache, hooks, transports |
| `packages/vite` | The build plugin — provisions + generates into `@gleanql/client` |
| `examples/*` | Bootable apps; `rwsdk-real` also runs the jsdom test harness |
| `docs/` | The documentation, as markdown — rendered by the app in `site/` |

## The rules that aren't obvious

- **Golden fixtures lock the compiler.** Every analyzer behavior lives in
  `packages/compiler/test/fixtures/<case>/` as `input.tsx` plus expected
  outputs, asserted byte-for-byte through two type-checker engines. A new
  behavior means a new fixture; a changed behavior means you can explain the
  diff in every fixture it touches.
- **Generated modules are template strings, gated by a parser.** Emitters live
  in `packages/vite/src/emit/` on a small DSL (`emit/module.ts`). Every
  emitter's output must pass `packages/vite/test/emit-syntax.test.ts` — add
  new emitters to that matrix.
- **`@gleanql/compiler` must never declare `sideEffects: false`.** Its default
  backend registers via an import side effect; the flag makes esbuild
  tree-shake the registration away.
- **The runtime stays schema-convention-free.** No Relay-style conventions
  baked into core/compiler (no connection magic, no directives that teach the
  compiler about mutations). Prefer runtime primitives the app calls
  explicitly.
- **Generated glue stays thin.** Real logic lives in typed modules
  (`glue-client.ts`, `glue-server.ts`); generated files are shims over them.

## Running one thing

```bash
pnpm vitest run packages/compiler/test/golden.test.ts   # one file
pnpm vitest run -t "merges duplicate"                   # one test by name
cd examples/rwsdk-real && pnpm dev                       # a real app
cd examples/rwsdk-real && pnpm test                      # the consumer harness
```

## Sending changes

Branch from `main`, keep commits scoped, and make sure `pnpm test` and
`pnpm typecheck` pass. CI also builds every example app on every push, runs a
pack→install→generate e2e that proves standalone consumption, and runs the
suite on Linux and Windows.
