import { DocsLayout } from "../layout";
import { Code } from "../code";

export function IndexPage() {
  return (
    <DocsLayout active="index.html">
      <title>Overview · glean</title>
      <h1>Glean — TypeScript-Native GraphQL Query Compiler</h1>
      <p className="lede">A framework-agnostic data system that uses GraphQL <em>internally</em> but never exposes
      GraphQL documents, fragments, or selector blocks in application code. Components look like ordinary
      React/TypeScript; the compiler infers the operation from normal field reads and prop flow.</p>

      <h2>The idea in one screen</h2>
      <p>You write plain components. Field access <em>is</em> the data requirement.</p>
<Code lang="tsx">{`
import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }) {
  const product = glean.product({ handle: params.handle });
  return <><ProductHero product={product} /><BuyBox product={product} /></>;
}

function BuyBox({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  return <button>{price.amount} {price.currencyCode}</button>;
}
`}</Code>

      <p>The compiler reads those property accesses across the whole route, follows the value through JSX
      props, de-duplicates, and emits one operation — plus a variables factory and a per-component read map:</p>

<Code lang="graphql">{`
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
    featuredImage { __typename url }
    priceRange {
      __typename
      minVariantPrice { __typename amount currencyCode }
    }
  }
}
`}</Code>

      <div className="note"><strong>No GraphQL in app code.</strong> No hand-written fragments, no <code>select</code> blocks,
      no <code>dataComponent(...)</code> wrappers, no exposed <code>ProductRef</code> type. Userland types look like
      schema types (<code>Product</code>, <code>Image</code>, <code>MoneyV2</code>).</div>

      <div className="note"><strong>Writes, the same way.</strong> Mutations are compile-time too: a gqty-style
      <code>useMutation((m, vars) =&gt; m.cartLinesAdd(vars).cart.totalQuantity)</code> selector compiles to a named
      operation — no schema convention, no hand-written document. The result normalizes into the cache, so every
      read of a mutated entity updates in place.</div>

      <div className="note"><strong>Fine-grained reactivity.</strong> The normalized cache versions each record, so a
      component re-renders only on the records it actually read — a mutation or refetch skips the components whose
      records are untouched.</div>

      <h2>What this repository contains</h2>
      <p>It started as the <span className="pill">PoC milestone</span> from the implementation brief — taking
      <code>.tsx</code> source all the way to a validated GraphQL operation and a Suspense-aware runtime — and has since
      grown the write side (<code>useMutation</code>), fine-grained reactivity, and the RedwoodSDK + React Router
      integrations, each end-to-end with tests.</p>

      <p className="note">An app installs <strong>two</strong> packages: <code>@gleanql/client</code> (runtime) and
      <code>@gleanql/vite</code> (build plugin). The rest are internal building blocks.</p>
      <div className="cards">
        <div className="card"><h3>@gleanql/client</h3><p>The runtime you install: cache, Suspense, graph proxies + <code>bindGraph</code>, request scope, the RedwoodSDK integration, the fetch transport, the React hooks/hydrator glue (<code>react</code> peer, &gt;=18) — plus a <code>generated/</code> slot for the schema.</p><a href="/runtime.html">Read →</a></div>
        <div className="card"><h3>@gleanql/vite</h3><p>The build plugin: provisions <code>@gleanql/client</code>, runs codegen + the compiler, and writes the <code>glean</code> accessor / types / operations into it. Framework-specific wiring lives behind a <code>FrameworkPreset</code> (<code>"rwsdk"</code> / <code>"react-router"</code>).</p><a href="/vite.html">Read →</a></div>
        <div className="card"><h3>@gleanql/core</h3><p>Query IR, the <code>q.*</code> builder, the selection merger, the GraphQL printer, schema model, devtools.</p><a href="/core.html">Read →</a></div>
        <div className="card"><h3>@gleanql/compiler</h3><p>Backend seam + a <code>typescript</code> backend, and the analyzer that extracts reads &amp; prop flow.</p><a href="/compiler.html">Read →</a></div>
        <div className="card"><h3>@gleanql/codegen</h3><p>Introspection → the <code>SchemaModel</code>, branded TS types, and the <code>glean</code> accessors.</p><a href="/codegen.html">Read →</a></div>
      </div>

      <h2>Quick start</h2>
      <p>Head to <a href="/get-started.html"><strong>Get started</strong></a> — install two packages, point the plugin
      at your schema, write a component. The build gives you one compiled operation per route, a typed accessor, a
      normalized reactive cache, a persisted-operation allowlist, and the <code>/__glean</code> devtools page.</p>

      <p className="note"><strong>Three real, bootable examples.</strong>{" "}
      <code>examples/rwsdk-real</code> is a genuine RedwoodSDK app (React 19 RSC on workerd) demoing persisted mode,
      registered operations, live subscriptions and the event channel; <code>examples/rwsdk-todo</code> is TodoMVC on
      a SQLite Durable Object with optimistic membership; <code>examples/remix-real</code> is the same data layer on
      React Router 7 (isomorphic SSR — not RSC), proving the framework binding is pluggable. None commit any graph glue.</p>

      <p>Working on Glean itself? <code>pnpm install && pnpm test</code> runs the full suite (380+ tests: golden
      fixtures through two type-checker engines, runtime, adapters, codegen, the build plugin); <code>pnpm
      typecheck</code> covers every package against one root tsconfig.</p>

      <h2>How it fits together</h2>
{/* prettier-ignore */}
<div className="flow">{`  .tsx source
      │
      ▼
  ┌──────────────────────────┐     GraphCompilerBackend (typescript default,
  │  @gleanql/compiler          │ ◀── experimental tsgo — same interface)
  │  analyzer + backend seam  │
  └──────────────────────────┘
      │  builds a mutable selection tree + read map + variables
      ▼
  ┌──────────────────────────┐
  │  @gleanql/core              │  merge → inject identity → alias → order → print
  │  IR · merger · printer    │
  └──────────────────────────┘
      │  OperationArtifact { document, variables, readMap, hash, stats }
      ├──────────────▶ @gleanql/vite   → generates into @gleanql/client
      ▼
  ┌──────────────────────────┐
  │  @gleanql/client   │  seed cache → sync reads → Suspense on misses
  │  cache · Suspense · batch │  → batched patch fetch → hydrate
  └──────────────────────────┘`}</div>

      <p>To build with it, head to <a href="/usage.html">Using Glean</a> — a task-oriented tour (read, mutate, paginate,
      subscribe, optimistic UI). To see how this compares to the alternatives, read{" "}
      <a href="/comparison.html">vs Relay &amp; gqty</a>. For the internals, continue to <a href="/architecture.html">Architecture &amp; pipeline</a>
      for the worked example, or jump to a package on the left.</p>

      <footer>Glean — TypeScript-Native GraphQL Query Compiler — 380+ tests, type-clean. Generated operations are validated against the real schema with graphql-js.</footer>
    </DocsLayout>
  );
}
