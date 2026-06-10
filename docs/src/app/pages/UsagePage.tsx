import { DocsLayout } from "../layout";
import { Code } from "../code";

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
<Code lang="bash">{`
# the runtime you import from, and the Vite plugin that generates into it
pnpm add @gleanql/client @gleanql/vite
`}</Code>
      <p>Add the plugin to <code>vite.config.ts</code>, pointing it at your schema SDL. The <code>framework</code> binding
      defaults to <code>"rwsdk"</code> (set <code>"react-router"</code> otherwise). It runs codegen + the compiler and
      writes the generated <code>glean</code> accessor, types, and operations into <code>@gleanql/client</code>; routes and
      selector-hook islands are auto-discovered:</p>
<Code lang="tsx">{`
import { glean } from "@gleanql/vite";

export default {
  plugins: [glean({ schema: "schema.graphql" })], // framework: "rwsdk" (default) | "react-router"
};
`}</Code>
      <p>Now <code>@gleanql/client</code> exposes a typed <code>glean</code> accessor (one callable per Query root) and, for{" "}
      <code>"use client"</code> islands, the <code>@gleanql/client/client</code> hooks. Schema types are importable as plain
      TS types. See <a href="/vite.html">@gleanql/vite</a> and the <a href="/rwsdk.html">RedwoodSDK</a> /{" "}
      <a href="/react-router.html">React Router</a> integration pages for the per-framework wiring.</p>

      <h2>2 · Read data</h2>
      <p>Open a root with the accessor and read fields off it like any object. The reads, followed across the whole route
      (including through JSX props into child components), <em>become</em> the operation:</p>
<Code lang="tsx">{`
import { glean } from "@gleanql/client";
import type { Product } from "@gleanql/client/schema";

export default function ProductRoute({ params }) {
  const product = glean.product({ handle: params.handle }); // root call → a $handle variable
  return <><Hero product={product} /><BuyBox product={product} /></>;
}

function BuyBox({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice; // nested reads fold in too
  return <button>{price.amount} {price.currencyCode}</button>;
}
`}</Code>
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
<Code lang="tsx">{`
"use client";
import { useGlean } from "@gleanql/client/client";

export function Availability({ handle }: { handle: string }) {
  const glean = useGlean();             // re-renders fine-grained as the cache changes
  const product = glean?.product({ handle });
  return <span>{product?.availableForSale ? "In stock" : "Sold out"}</span>;
}
`}</Code>
      <p>An island re-renders only when a record <em>it</em> read changes (per-field tracking), and again on
      hydration/navigation so it re-resolves the page's roots. See <a href="/runtime.html">@gleanql/client</a> for the
      reactivity model.</p>

      <h2>4 · Lists &amp; list roots</h2>
      <p>Map over a list field or a top-level list root; the element reads fold into the op. A list root
      (<code>type Query &#123; todos: [Todo!] &#125;</code>) needs no wrapper:</p>
<Code lang="json">{`
{glean.todos().map((todo) => (
  <li key={todo.id}>{todo.title}</li>  // id + title fold into  todos { id title }
))}
`}</Code>

      <h2>5 · Write data (mutations)</h2>
      <p>Mutations compile the same way — a gqty-style selector defines the operation; the build injects its name. The
      result normalizes into the cache, so every reader of the mutated entity updates <em>in place</em>:</p>
<Code lang="tsx">{`
import { useMutation } from "@gleanql/client/client";

const [toggle, { isLoading }] = useMutation((m, vars: { id: string }) => m.toggleTodo(vars).completed);

await toggle({ id });  // server returns the entity → its \`completed\` flips wherever it's shown
`}</Code>
      <p>A selector can pull several fields back by returning an array/object of reads
      (<code>(m, vars) =&gt; &#123; const t = m.addTodo(vars); return [t.id, t.title, t.completed]; &#125;</code>). The hook returns{" "}
      <code>[mutate, state]</code> with <code>data</code>/<code>error</code>/<code>userErrors</code>; it never rejects for
      logical failures.</p>

      <h2>6 · Optimistic UI</h2>
      <p>For a snappy add/remove, update the UI before the server responds. Field changes use{" "}
      <code>optimistic</code> (cache writes, auto-rolled-back); list <em>membership</em> uses{" "}
      <code>optimisticRoots</code> (auto-rolled-back). Generate the id client-side so the optimistic row is the final
      row — the mutation normalizes over the same identity, nothing to reconcile:</p>
<Code lang="tsx">{`
const [add] = useMutation(selector, {
  optimisticRoots: (roots, vars) =>
    roots.append("todos", { __typename: "Todo", id: vars.id, title: vars.title, completed: false }, { prepend: true }),
});

await add({ id: crypto.randomUUID(), title }); // row appears now; rolls back if the mutation fails
`}</Code>
      <p>Or splice membership directly with <code>appendToRoot</code> / <code>removeFromRoot</code> for a post-confirmation
      update. Details in <a href="/runtime.html">@gleanql/client → List-root membership</a>.</p>

      <h2>7 · Paginate</h2>
      <p>Read a connection in render, then <code>usePaginated</code> gives you a <code>fetchMore</code> that re-runs that
      connection's selection with your cursor args and merges the page (default: concat <code>nodes</code>). No
      convention is assumed — you read <code>pageInfo</code>/cursors yourself, so exactly what you use is fetched:</p>
<Code lang="tsx">{`
const products = glean.collection({ handle }).products({ first: 20 });
const { fetchMore, isLoading } = usePaginated(products);

// onClick: await fetchMore({ first: 20, after: products.pageInfo.endCursor });
`}</Code>

      <h2>8 · Live data (subscriptions)</h2>
      <p>A <code>useSubscription</code> selector roots at the <code>Subscription</code> type and compiles like a mutation.
      Each pushed payload normalizes into the cache, so readers re-render fine-grained:</p>
<Code lang="tsx">{`
const { data } = useSubscription((s, vars: { handle: string }) => s.productChanged(vars).price, {
  variables: { handle },
});
`}</Code>
      <p>The in-box fetch adapter streams subscriptions over Server-Sent Events; for WebSockets, pass a{" "}
      <code>graphql-ws</code> client to <code>createGraphWsAdapter</code> — same seam, no compile or hook changes.</p>

      <h2>9 · Refetch</h2>
      <p><code>refresh()</code> re-runs the current page's operation over the wire and re-seeds the cache (reconciled by
      identity, so only changed fields re-render). Use it after a change that doesn't return the affected entities — e.g.
      a bulk update returning a count:</p>
<Code lang="tsx">{`
import { refresh } from "@gleanql/client/client";
await refresh();                 // whole page op
await refresh({ component: "Views" }); // just one component's read-slice
`}</Code>

      <h2>10 · Lock down the wire (persisted operations)</h2>
      <p>The build compiled every operation the app can send, so the server can refuse anything else. Turn it on in
      one place — the client then sends only sha-256 hashes (the APQ wire shape), never documents:</p>
<Code lang="tsx">{`
// vite.config.ts
glean({ schema: "./schema.graphql", persisted: true });

// your /graphql endpoint (same deploy: feed it the generated operations map)
import { createPersistedResolver, operations } from "@gleanql/client";
const resolve = createPersistedResolver(operations);

const r = resolve(body);
if (r.kind === "not-found") return json({ errors: [{ message: "PersistedQueryNotFound" }] });
if (r.kind === "rejected")  return json({ errors: [{ message: "Not allowed" }] }, 400);
return json(await execute(r.document, body.variables));
`}</Code>
      <p>For a separately-deployed GraphQL server, sync the build-emitted <code>generated/persisted.json</code>{" "}
      (hash → document) instead. Working end-to-end in <code>examples/rwsdk-real</code>.</p>

      <h2>11 · Hand-built operations (dynamic shapes)</h2>
      <p>The compiler covers reads it can see. For a shape it can't extract — a report whose selection your code
      composes — build the IR by hand and <strong>register</strong> it: the build prints + hashes it and ships it like
      a compiled operation (same generated map, same persisted allowlist, same <code>/__glean</code> page).</p>
<Code lang="tsx">{`
// src/report-operations.ts — exports are OperationIR (run AT BUILD TIME)
import { buildQuery } from "@gleanql/core";

export const Report = buildQuery("Report", { handle: "String!" }, (root, $) => ({
  product: root.product({ handle: $.handle }, (p) => ({ title: p.title, vendor: p.vendor })),
}));

// vite.config.ts
glean({ schema, operations: "./src/report-operations.ts" });

// anywhere at runtime — executes by name, seeds the normalized cache
import { runOperation } from "@gleanql/client/client";
const result = await runOperation("Report", { handle });
`}</Code>
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
