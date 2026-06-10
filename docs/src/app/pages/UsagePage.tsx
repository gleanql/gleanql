import { DocsLayout } from "../layout";

export function UsagePage() {
  return (
    <DocsLayout active="usage.html">
      <title>Using Glean · glean</title>
      <h1>Using Glean</h1>
      <p className="lede">A task-oriented tour: install it, read data, write data, paginate, subscribe, and do optimistic
      UI — all without writing a single GraphQL document. The rule throughout: <strong>a field access is a data
      requirement</strong>. You read fields like normal object properties; the compiler turns those reads into one
      operation per route.</p>

      <h2>1 · Install &amp; wire up</h2>
      <p>An app installs two packages — the runtime and the build plugin. Everything else is internal.</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"# the runtime you import from, and the Vite plugin that generates into it"}</span>{"\npnpm add @gleanql/client @gleanql/vite"}</code></pre>
      <p>Add the plugin to <code>vite.config.ts</code>, pointing it at your schema SDL. The <code>framework</code> binding
      defaults to <code>"rwsdk"</code> (set <code>"react-router"</code> otherwise). It runs codegen + the compiler and
      writes the generated <code>glean</code> accessor, types, and operations into <code>@gleanql/client</code>; routes and
      selector-hook islands are auto-discovered:</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"import"}</span>{" { glean } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/vite\""}</span>{";\n\n"}<span className="k">{"export default"}</span>{" {\n  plugins: ["}<span className="f">{"glean"}</span>{"({ schema: "}<span className="s">{"\"schema.graphql\""}</span>{" })], "}<span className="c">{"// framework: \"rwsdk\" (default) | \"react-router\""}</span>{"\n};"}</code></pre>
      <p>Now <code>@gleanql/client</code> exposes a typed <code>glean</code> accessor (one callable per Query root) and, for{" "}
      <code>"use client"</code> islands, the <code>@gleanql/client/client</code> hooks. Schema types are importable as plain
      TS types. See <a href="/vite.html">@gleanql/vite</a> and the <a href="/rwsdk.html">RedwoodSDK</a> /{" "}
      <a href="/react-router.html">React Router</a> integration pages for the per-framework wiring.</p>

      <h2>2 · Read data</h2>
      <p>Open a root with the accessor and read fields off it like any object. The reads, followed across the whole route
      (including through JSX props into child components), <em>become</em> the operation:</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"import"}</span>{" { glean } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client\""}</span>{";\n"}<span className="k">{"import type"}</span>{" { Product } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client/schema\""}</span>{";\n\n"}<span className="k">{"export default function"}</span>{" "}<span className="f">{"ProductRoute"}</span>{"({ params }) {\n  "}<span className="k">{"const"}</span>{" product = glean."}<span className="f">{"product"}</span>{"({ handle: params.handle }); "}<span className="c">{"// root call → a $handle variable"}</span>{"\n  "}<span className="k">{"return"}</span>{" <><"}<span className="t">{"Hero"}</span>{" product={product} /><"}<span className="t">{"BuyBox"}</span>{" product={product} /></>;\n}\n\n"}<span className="k">{"function"}</span>{" "}<span className="f">{"BuyBox"}</span>{"({ product }: { product: "}<span className="t">{"Product"}</span>{" }) {\n  "}<span className="k">{"const"}</span>{" price = product.priceRange.minVariantPrice; "}<span className="c">{"// nested reads fold in too"}</span>{"\n  "}<span className="k">{"return"}</span>{" <button>{price.amount} {price.currencyCode}</button>;\n}"}</code></pre>
      <p>The compiler de-dups the reads across <code>Hero</code> + <code>BuyBox</code> and emits a single{" "}
      <code>query ProductRoute($handle: String!) &#123; product(handle: $handle) &#123; … &#125; &#125;</code> plus a variables factory. At
      runtime a read hits the warm cache; a field absent from the seed suspends and is batch-fetched. No{" "}
      <code>select</code> blocks, no fragments, no <code>ProductRef</code> — userland types look like schema types.</p>
      <div className="note"><strong>Root arguments become variables.</strong> <code>glean.product(&#123; handle: params.handle &#125;)</code>{" "}
      lifts <code>handle</code> into <code>$handle</code> with a generated factory; a transformed local
      (<code>const h = params.handle.toLowerCase()</code>) is reproduced in the factory too.</div>

      <h2>3 · Server components vs. islands</h2>
      <p>A server component reads through the isomorphic <code>glean</code> accessor (above). A{" "}
      <code>"use client"</code> <strong>island</strong> reads through the <code>useGlean()</code> hook — its reads still
      fold into the owning route's operation at compile time, so it hydrates warm:</p>
{/* prettier-ignore */}
<pre><code><span className="s">{"\"use client\""}</span>{";\n"}<span className="k">{"import"}</span>{" { useGlean } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client/client\""}</span>{";\n\n"}<span className="k">{"export function"}</span>{" "}<span className="f">{"Availability"}</span>{"({ handle }: { handle: string }) {\n  "}<span className="k">{"const"}</span>{" glean = "}<span className="f">{"useGlean"}</span>{"();             "}<span className="c">{"// re-renders fine-grained as the cache changes"}</span>{"\n  "}<span className="k">{"const"}</span>{" product = glean?."}<span className="f">{"product"}</span>{"({ handle });\n  "}<span className="k">{"return"}</span>{" <span>{product?.availableForSale ? "}<span className="s">{"\"In stock\""}</span>{" : "}<span className="s">{"\"Sold out\""}</span>{"}</span>;\n}"}</code></pre>
      <p>An island re-renders only when a record <em>it</em> read changes (per-field tracking), and again on
      hydration/navigation so it re-resolves the page's roots. See <a href="/runtime.html">@gleanql/client</a> for the
      reactivity model.</p>

      <h2>4 · Lists &amp; list roots</h2>
      <p>Map over a list field or a top-level list root; the element reads fold into the op. A list root
      (<code>type Query &#123; todos: [Todo!] &#125;</code>) needs no wrapper:</p>
{/* prettier-ignore */}
<pre><code>{"{glean."}<span className="f">{"todos"}</span>{"()."}<span className="f">{"map"}</span>{"((todo) => (\n  <li key={todo.id}>{todo.title}</li>  "}<span className="c">{"// id + title fold into  todos { id title }"}</span>{"\n))}"}</code></pre>

      <h2>5 · Write data (mutations)</h2>
      <p>Mutations compile the same way — a gqty-style selector defines the operation; the build injects its name. The
      result normalizes into the cache, so every reader of the mutated entity updates <em>in place</em>:</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"import"}</span>{" { useMutation } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client/client\""}</span>{";\n\n"}<span className="k">{"const"}</span>{" [toggle, { isLoading }] = "}<span className="f">{"useMutation"}</span>{"((m, vars: { id: string }) => m."}<span className="f">{"toggleTodo"}</span>{"(vars).completed);\n\n"}<span className="k">{"await"}</span>{" "}<span className="f">{"toggle"}</span>{"({ id });  "}<span className="c">{"// server returns the entity → its `completed` flips wherever it's shown"}</span></code></pre>
      <p>A selector can pull several fields back by returning an array/object of reads
      (<code>(m, vars) =&gt; &#123; const t = m.addTodo(vars); return [t.id, t.title, t.completed]; &#125;</code>). The hook returns{" "}
      <code>[mutate, state]</code> with <code>data</code>/<code>error</code>/<code>userErrors</code>; it never rejects for
      logical failures.</p>

      <h2>6 · Optimistic UI</h2>
      <p>For a snappy add/remove, update the UI before the server responds. Field changes use{" "}
      <code>optimistic</code> (cache writes, auto-rolled-back); list <em>membership</em> uses{" "}
      <code>optimisticRoots</code> (auto-rolled-back). Generate the id client-side so the optimistic row is the final
      row — the mutation normalizes over the same identity, nothing to reconcile:</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"const"}</span>{" [add] = "}<span className="f">{"useMutation"}</span>{"(selector, {\n  optimisticRoots: (roots, vars) =>\n    roots."}<span className="f">{"append"}</span>{"("}<span className="s">{"\"todos\""}</span>{", { __typename: "}<span className="s">{"\"Todo\""}</span>{", id: vars.id, title: vars.title, completed: "}<span className="k">{"false"}</span>{" }, { prepend: "}<span className="k">{"true"}</span>{" }),\n});\n\n"}<span className="k">{"await"}</span>{" "}<span className="f">{"add"}</span>{"({ id: crypto."}<span className="f">{"randomUUID"}</span>{"(), title }); "}<span className="c">{"// row appears now; rolls back if the mutation fails"}</span></code></pre>
      <p>Or splice membership directly with <code>appendToRoot</code> / <code>removeFromRoot</code> for a post-confirmation
      update. Details in <a href="/runtime.html">@gleanql/client → List-root membership</a>.</p>

      <h2>7 · Paginate</h2>
      <p>Read a connection in render, then <code>usePaginated</code> gives you a <code>fetchMore</code> that re-runs that
      connection's selection with your cursor args and merges the page (default: concat <code>nodes</code>). No
      convention is assumed — you read <code>pageInfo</code>/cursors yourself, so exactly what you use is fetched:</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"const"}</span>{" products = glean."}<span className="f">{"collection"}</span>{"({ handle })."}<span className="f">{"products"}</span>{"({ first: 20 });\n"}<span className="k">{"const"}</span>{" { fetchMore, isLoading } = "}<span className="f">{"usePaginated"}</span>{"(products);\n\n"}<span className="c">{"// onClick:"}</span>{" "}<span className="k">{"await"}</span>{" "}<span className="f">{"fetchMore"}</span>{"({ first: 20, after: products.pageInfo.endCursor });"}</code></pre>

      <h2>8 · Live data (subscriptions)</h2>
      <p>A <code>useSubscription</code> selector roots at the <code>Subscription</code> type and compiles like a mutation.
      Each pushed payload normalizes into the cache, so readers re-render fine-grained:</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"const"}</span>{" { data } = "}<span className="f">{"useSubscription"}</span>{"((s, vars: { handle: string }) => s."}<span className="f">{"productChanged"}</span>{"(vars).price, {\n  variables: { handle },\n});"}</code></pre>
      <p>The in-box fetch adapter streams subscriptions over Server-Sent Events; for WebSockets, pass a{" "}
      <code>graphql-ws</code> client to <code>createGraphWsAdapter</code> — same seam, no compile or hook changes.</p>

      <h2>9 · Refetch</h2>
      <p><code>refresh()</code> re-runs the current page's operation over the wire and re-seeds the cache (reconciled by
      identity, so only changed fields re-render). Use it after a change that doesn't return the affected entities — e.g.
      a bulk update returning a count:</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"import"}</span>{" { refresh } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client/client\""}</span>{";\n"}<span className="k">{"await"}</span>{" "}<span className="f">{"refresh"}</span>{"();                 "}<span className="c">{"// whole page op"}</span>{"\n"}<span className="k">{"await"}</span>{" "}<span className="f">{"refresh"}</span>{"({ component: "}<span className="s">{"\"Views\""}</span>{" }); "}<span className="c">{"// just one component's read-slice"}</span></code></pre>

      <h2>10 · Lock down the wire (persisted operations)</h2>
      <p>The build compiled every operation the app can send, so the server can refuse anything else. Turn it on in
      one place — the client then sends only sha-256 hashes (the APQ wire shape), never documents:</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"// vite.config.ts"}</span>{"\n"}<span className="f">{"glean"}</span>{"({ schema: "}<span className="s">{"\"./schema.graphql\""}</span>{", persisted: "}<span className="k">{"true"}</span>{" });\n\n"}<span className="c">{"// your /graphql endpoint (same deploy: feed it the generated operations map)"}</span>{"\n"}<span className="k">{"import"}</span>{" { createPersistedResolver, operations } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client\""}</span>{";\n"}<span className="k">{"const"}</span>{" resolve = "}<span className="f">{"createPersistedResolver"}</span>{"(operations);\n\n"}<span className="k">{"const"}</span>{" r = "}<span className="f">{"resolve"}</span>{"(body);\n"}<span className="k">{"if"}</span>{" (r.kind === "}<span className="s">{"\"not-found\""}</span>{") "}<span className="k">{"return"}</span>{" json({ errors: [{ message: "}<span className="s">{"\"PersistedQueryNotFound\""}</span>{" }] });\n"}<span className="k">{"if"}</span>{" (r.kind === "}<span className="s">{"\"rejected\""}</span>{")  "}<span className="k">{"return"}</span>{" json({ errors: [{ message: "}<span className="s">{"\"Not allowed\""}</span>{" }] }, 400);\n"}<span className="k">{"return"}</span>{" json("}<span className="k">{"await"}</span>{" "}<span className="f">{"execute"}</span>{"(r.document, body.variables));"}</code></pre>
      <p>For a separately-deployed GraphQL server, sync the build-emitted <code>generated/persisted.json</code>{" "}
      (hash → document) instead. Working end-to-end in <code>examples/rwsdk-real</code>.</p>

      <h2>11 · Hand-built operations (dynamic shapes)</h2>
      <p>The compiler covers reads it can see. For a shape it can't extract — a report whose selection your code
      composes — build the IR by hand and <strong>register</strong> it: the build prints + hashes it and ships it like
      a compiled operation (same generated map, same persisted allowlist, same <code>/__glean</code> page).</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"// src/report-operations.ts — exports are OperationIR (run AT BUILD TIME)"}</span>{"\n"}<span className="k">{"import"}</span>{" { buildQuery } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/core\""}</span>{";\n\n"}<span className="k">{"export const"}</span>{" "}<span className="t">{"Report"}</span>{" = "}<span className="f">{"buildQuery"}</span>{"("}<span className="s">{"\"Report\""}</span>{", { handle: "}<span className="s">{"\"String!\""}</span>{" }, (root, $) => ({\n  product: root."}<span className="f">{"product"}</span>{"({ handle: $.handle }, (p) => ({ title: p.title, vendor: p.vendor })),\n}));\n\n"}<span className="c">{"// vite.config.ts"}</span>{"\n"}<span className="f">{"glean"}</span>{"({ schema, operations: "}<span className="s">{"\"./src/report-operations.ts\""}</span>{" });\n\n"}<span className="c">{"// anywhere at runtime — executes by name, seeds the normalized cache"}</span>{"\n"}<span className="k">{"import"}</span>{" { runOperation } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client/client\""}</span>{";\n"}<span className="k">{"const"}</span>{" result = "}<span className="k">{"await"}</span>{" "}<span className="f">{"runOperation"}</span>{"("}<span className="s">{"\"Report\""}</span>{", { handle });"}</code></pre>
      <p><strong>Fully typed:</strong> the build renders a <code>GleanOperations</code> interface from every
      operation's selection + variable definitions, so <code>runOperation("Report", …)</code> checks the variables
      and infers the result shape — no hand-written types, no casts.</p>
      <p className="note"><strong>The boundary:</strong> the module runs at <em>build</em> time, so the shape must be
      deterministic then (the variables stay runtime-dynamic). A selection composed from <em>user input at runtime</em>{" "}
      can't be allowlisted by definition — for that, keep a separate endpoint or <code>allowUnpersisted</code>.</p>

      <h2>12 · Handle errors</h2>
      <p>Each surface has one error channel — nothing is swallowed:</p>
      <table>
        <tr><th>Surface</th><th>What you get</th></tr>
        <tr><td>Route preload (server)</td><td><code>runRoute</code>/<code>integration.preload</code> return <code>errors</code> alongside <code>roots</code>; a missing root is your 404 branch (see the examples' <code>preload()</code>).</td></tr>
        <tr><td>Reads (<code>useGlean</code>)</td><td>a cache miss suspends; if the batched <code>fetchMissing</code> <em>fails</em>, the suspended promise rejects — a React <strong>error boundary</strong> around the route/island catches it. <code>unexpectedMissingField: "warn" | "error"</code> turns silent misses into console warnings or throws.</td></tr>
        <tr><td><code>useMutation</code></td><td><code>[mutate, state]</code> — transport/GraphQL failures land in <code>state.error</code>; LOGICAL failures (your schema's <code>userErrors</code>) land in <code>state.userErrors</code>. <code>await mutate(vars)</code> never rejects on logical failures; optimistic writes roll back automatically.</td></tr>
        <tr><td><code>useSubscription</code></td><td><code>&#123; data, error &#125;</code> — a dropped stream surfaces as <code>error</code>; the SSE transport auto-reconnects and keeps the stream open.</td></tr>
        <tr><td><code>refresh()</code> / <code>fetchMore()</code></td><td>returned promises reject on transport failure — <code>await</code> them where you trigger them.</td></tr>
        <tr><td>Transport</td><td>a non-JSON response (proxy 502 HTML) throws a clear <code>graph fetch: non-JSON response…</code> error instead of a JSON parse error; GraphQL <code>errors</code> always ride the result.</td></tr>
      </table>
      <p className="note"><strong>Rule of thumb:</strong> one error boundary per route + one per island. Reads inside
      either suspend (loading) or reject into the boundary (failure); writes report through their hook state instead of
      throwing.</p>

      <h2>Where to go next</h2>
      <ul>
        <li><a href="/runtime.html">@gleanql/client</a> — the runtime: cache identity, reactivity, hooks, adapter, mutations.</li>
        <li><a href="/compiler.html">@gleanql/compiler</a> — what the analyzer folds (reads, prop flow, lists, unions, list/mid-chain roots).</li>
        <li><a href="/rwsdk.html">RedwoodSDK</a> / <a href="/react-router.html">React Router</a> — per-framework setup.</li>
        <li><a href="/api.html">API reference</a> — the full exported surface.</li>
        <li><a href="/golden-cases.html">Golden cases</a> — the behavior catalog (input.tsx → operation).</li>
      </ul>

      <footer>A field access is a data requirement — write components, get one operation per route.</footer>
    </DocsLayout>
  );
}
