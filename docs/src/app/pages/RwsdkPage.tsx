import { DocsLayout } from "../layout";

export function RwsdkPage() {
  return (
    <DocsLayout active="rwsdk.html">
      <title>RedwoodSDK integration · glean</title>
      <h1>RedwoodSDK integration</h1>
      <p className="lede">A framework integration target — now one of <strong>two</strong> built-in{" "}
      <a href="/vite.html">framework presets</a> (alongside React Router 7). RedwoodSDK is an <em>adapter</em>, not the
      foundation — the core compiler and runtime have no dependency on it. Like <code>@gleanql/vite</code> is to Vite,
      this package is decoupled from <code>rwsdk</code> itself: it matches the framework's shapes structurally
      (a <code>RequestInfo</code>), so it tests in isolation and pins no framework version.</p>
      <div className="note"><strong>RSC vs. isomorphic.</strong> RedwoodSDK is the <em>RSC</em> preset (server/client split;
      the graph snapshot rides the flight stream). The <code>react-router</code> preset proves the binding is pluggable
      with an <em>isomorphic, non-RSC</em> host — see <code>examples/remix-real</code> and{" "}
      <a href="/vite.html">@gleanql/vite</a>.</div>

      <h2>What an adapter answers</h2>
      <p>The brief asks four questions of any framework adapter. This package answers them:</p>
      <table>
        <tr><th>Question</th><th>How</th></tr>
        <tr><td>Which operation drives this entrypoint?</td><td><code>resolveOperationName</code> / an explicit name passed to <code>preload</code></td></tr>
        <tr><td>How do we read params/search/request/env?</td><td><code>buildRouteContext(requestInfo, &#123; context &#125;)</code></td></tr>
        <tr><td>How do we preload + seed?</td><td><code>runRoute</code> into a fresh <em>per-request</em> cache</td></tr>
        <tr><td>How do we expose the graph &amp; hydrate?</td><td>bound graph on <code>ctx</code> + <code>serializeGraph</code>/<code>hydrateGraph</code></td></tr>
      </table>

      <h2>Setup</h2>
      <p>Create one integration with the compiled operations (generated into <code>@gleanql/client</code>), the
      schema, and a transport adapter. <code>context</code> contributes auth/locale/env; <code>clientSafeContext</code>{" "}
      is the allow-list of context keys safe to serialize — secrets stay server-side.</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"const"}</span>{" integration = "}<span className="f">{"createGraphIntegration"}</span>{"({\n  schema, operations, adapter,\n  context: ({ request }) => ({ locale: "}<span className="f">{"localeFor"}</span>{"(request), accessToken: env.TOKEN }),\n  clientSafeContext: ["}<span className="s">{"\"locale\""}</span>{"],          "}<span className="c">{"// accessToken is NOT serialized"}</span>{"\n  unexpectedMissingField: "}<span className="s">{"\"warn\""}</span>{",          "}<span className="c">{"// hybrid mode"}</span>{"\n  fetchMissing,                            "}<span className="c">{"// optional: batched lazy/patch fetcher"}</span>{"\n});"}</code></pre>

      <h2>Per request</h2>
      <p>Preload picks the operation, computes variables from the <code>RequestInfo</code>, executes via the adapter,
      seeds a fresh cache, and attaches <code>&#123; runtime, graph, roots, variables &#125;</code> to <code>requestInfo.ctx</code>.
      Concurrent requests are isolated in separate caches.</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"await"}</span>{" integration."}<span className="f">{"preload"}</span>{"(requestInfo, "}<span className="s">{"\"ProductRoute\""}</span>{");\n"}<span className="k">{"const"}</span>{" graph = integration."}<span className="f">{"getGraph"}</span>{"(requestInfo);\n"}<span className="c">{"// Pages/components read normally — cache hits, no GraphQL in sight:"}</span>{"\n"}<span className="k">{"const"}</span>{" product = graph."}<span className="f">{"product"}</span>{"({ handle: params.handle });\nproduct.title;  product.featuredImage?.url;  product.priceRange.minVariantPrice.amount;"}</code></pre>
      <p>If a module-level <code>import &#123; glean &#125; from "~/graph"</code> is preferred over reading <code>ctx</code>,
      back the integration with a <code>GraphScope</code> and wrap rendering in <code>integration.runInScope(requestInfo, render)</code>.</p>

      <h2>Serialize &amp; hydrate</h2>
      <p>Graph values are proxies, not JSON — so the cache is serialized, not the values. The hydration script escapes
      its payload so it cannot break out of the <code>&lt;script&gt;</code> element (<code>&lt;</code>, <code>&gt;</code>,{" "}
      <code>&amp;</code>, U+2028/U+2029). On the client, the runtime is rebuilt from the snapshot and the graph re-bound;
      warm reads hit, missing fields fetch through the client adapter.</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"// Server (in the Document):"}</span>{"\n"}<span className="k">{"const"}</span>{" payload = "}<span className="f">{"serializeGraph"}</span>{"(integration."}<span className="f">{"getActive"}</span>{"(requestInfo)!, { clientSafeContext: ["}<span className="s">{"\"locale\""}</span>{"] });\nhead += "}<span className="f">{"renderGraphHydrationScript"}</span>{"(payload, { nonce });\n\n"}<span className="c">{"// Client:"}</span>{"\n"}<span className="k">{"const"}</span>{" { graph } = "}<span className="f">{"hydrateGraph"}</span>{"("}<span className="f">{"readGraphHydrationPayload"}</span>{"()!, { schema, adapter });"}</code></pre>

      <h2>Boundary rules</h2>
      <ul>
        <li>Graph values are serializable as <em>handles + cache records</em>, never as live proxies.</li>
        <li>Only <code>clientSafeContext</code> keys cross to the client; tokens/secrets are dropped.</li>
        <li>Client components can trigger runtime missing-field fetches through the client adapter.</li>
        <li>Two hydration models ship: the simple SSR <code>&lt;script&gt;</code> model and the RSC flight model
          (snapshot as a client-component prop, folded into a long-lived runtime). See{" "}
          <a href="/runtime.html">@gleanql/client</a>.</li>
      </ul>

      <h2>Mutations</h2>
      <p>The integration also exposes the write side per request: <code>getMutator(requestInfo)</code> returns the{" "}
      <code>glean.mutate.*</code> namespace (one callable per compiled mutation operation), and{" "}
      <code>invalidate(requestInfo, value)</code> drops a record so the next read re-fetches. Results normalize into the
      per-request cache, so a mutation is immediately visible through the already-rendered graph.</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"const"}</span>{" result = "}<span className="k">{"await"}</span>{" integration."}<span className="f">{"getMutator"}</span>{"(requestInfo)."}<span className="f">{"ProductUpdate"}</span>{"(\n  { id, title: "}<span className="s">{"\"Renamed\""}</span>{" },\n  { optimistic: (tx) => tx."}<span className="f">{"set"}</span>{"(productRef, "}<span className="s">{"\"title\""}</span>{", "}<span className="s">{"\"Renamed\""}</span>{") },\n);"}</code></pre>

      <h2>Client islands &amp; refetch (mixing client + RSC)</h2>
      <p>RSC renders the page server-side; a <code>"use client"</code> island can refetch live — with{" "}
      <strong>no hydration boilerplate</strong>. The plugin generates the client glue too: a{" "}
      <code>@gleanql/client/client</code> module exposing <code>useGlean()</code> (the hydrated graph, re-rendering on cache
      change) and <code>refresh(operationName?)</code> (re-run the page's compiled operation over the wire). The app just
      imports them.</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"// a \"use client\" island — the only graph code the app writes"}</span>{"\n"}<span className="k">{"import"}</span>{" { useGlean, refresh } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client/client\""}</span>{";\n\n"}<span className="k">{"const"}</span>{" glean = "}<span className="f">{"useGlean"}</span>{"();                       "}<span className="c">{"// hydrated; re-renders on cache change"}</span>{"\n"}<span className="k">{"const"}</span>{" product = glean."}<span className="f">{"product"}</span>{"({ handle });   "}<span className="c">{"// warm read from the hydrated cache"}</span>{"\n"}<span className="c">{"// <button onClick={() => refresh()}> → /graphql → re-seed → cache notifies → re-render"}</span></code></pre>
      <p><code>refresh(operationName?)</code> re-runs the <em>entire</em> compiled operation for the current page (or the
      named one), bypassing cache-first, and re-seeds — it is a whole-operation refetch, not a field-level one. The
      normalized cache then reconciles by entity identity, so only changed fields actually re-render, but the network
      request fetches the whole operation; to refetch a smaller slice today, pass a smaller operation name.</p>
      <p>Under the hood the snapshot rides the <strong>RSC flight stream</strong>, not a <code>&lt;script&gt;</code>{" "}
      global: <code>@gleanql/vite</code> auto-injects a <code>&lt;GraphHydrate /&gt;</code> server component (from the
      generated <code>@gleanql/client/server</code> — a thin shim over <code>createGraphServer</code>) around each route
      component (the preset's <code>transformRoute</code> hook), passing this request's serialized payload. On every render the client side folds it into <strong>one
      long-lived</strong> browser runtime (<code>absorbHydrationPayload</code> → <code>runtime.absorbRecords</code>, so
      the cache accumulates across navigations) pointed at the configured <code>endpoint</code> (default{" "}
      <code>/graphql</code>), and wires <code>useSyncExternalStore</code> to <code>cache.subscribe</code>. It builds on the{" "}
      <em>client-safe</em> entrypoints <code>@gleanql/client/runtime</code> + <code>@gleanql/client/operations</code> (no
      request-scoped accessor → no server-only <code>rwsdk/worker</code> in the client bundle). Zero app glue: worker and
      page files are untouched, and there is no inline state <code>&lt;script&gt;</code>, so it sidesteps CSP.</p>

      <h2>A mutation island — writes update in place</h2>
      <p>The write side is a client island too, with the <strong>same zero graph glue</strong>. The generated{" "}
      <code>@gleanql/client/client</code> also exports <code>useMutation</code> (gqty-style). The selector{" "}
      <code>(m, vars) =&gt; …</code> is <strong>compile-time only</strong> — it defines the operation (rooted at the{" "}
      <code>Mutation</code> type) and types <code>vars</code>/<code>data</code>, but never runs: the build injects the
      compiled op name into the call site. Calling <code>rename(vars)</code> runs that op, and because the mutation returns
      the entity (<code>__typename</code> + <code>id</code>), the result normalizes <em>in place</em> into the same cache
      the page hydrated — so any island reading that record through <code>useGlean()</code> updates with no reload.</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"// a \"use client\" mutation island — the only graph code the app writes"}</span>{"\n"}<span className="k">{"import"}</span>{" { useGlean, useMutation } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client/client\""}</span>{";\n\n"}<span className="k">{"const"}</span>{" glean = "}<span className="f">{"useGlean"}</span>{"();                       "}<span className="c">{"// hydrated; re-renders fine-grained"}</span>{"\n"}<span className="k">{"const"}</span>{" product = glean?."}<span className="f">{"product"}</span>{"({ handle });\n"}<span className="k">{"const"}</span>{" title = product?.title ?? initialTitle; "}<span className="c">{"// reads the record the mutation writes"}</span>{"\n\n"}<span className="k">{"const"}</span>{" [rename, { isLoading, error }] = "}<span className="f">{"useMutation"}</span>{"(\n  (m, vars) => m."}<span className="f">{"setProductTitle"}</span>{"(vars).title,   "}<span className="c">{"// compile-time selector → kind:\"mutation\" op; never runs"}</span>{"\n);\n"}<span className="c">{"// <button onClick={() => rename({ id, title })}> → /graphql → returns {__typename,id,title}"}</span>{"\n"}<span className="c">{"//   → normalized in place → only THIS record's readers re-render → heading updates, no reload"}</span></code></pre>
      <p>Same engine as the server-side <code>runMutation</code> — <code>optimistic</code> / <code>update</code> /{" "}
      <code>invalidate</code> are available through the hook's options, and <code>userErrors</code> surface on the returned
      state. See <code>examples/rwsdk-real</code>'s <code>RenameTitle.tsx</code>.</p>

      <h2>The real app — zero glue (<code>@gleanql/vite</code>)</h2>
      <p><code>examples/rwsdk-real/</code> is a genuine RedwoodSDK app (React 19 RSC on workerd) that <em>boots</em>{" "}
      (<code>pnpm --filter @example/rwsdk-real dev</code>). It commits <strong>no graph glue at all</strong> — just a
      schema, routes/components, a transport, and one line in <code>vite.config.mts</code>:</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"// vite.config.mts"}</span>{"\n"}<span className="k">{"import"}</span>{" { defineConfig } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"vite\""}</span>{";\n"}<span className="k">{"import"}</span>{" { "}<span className="f">{"glean"}</span>{" } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/vite\""}</span>{";\n\n"}<span className="k">{"export default"}</span>{" "}<span className="f">{"defineConfig"}</span>{"({\n  plugins: [\n    "}<span className="f">{"glean"}</span>{"({ schema: "}<span className="s">{"\"schema.graphql\""}</span>{" }),  "}<span className="c">{"// routes auto-discovered"}</span>{"\n    "}<span className="f">{"cloudflare"}</span>{"(),\n    "}<span className="f">{"redwood"}</span>{"(),\n  ],\n});"}</code></pre>
      <p>On startup (before the directive scan) the plugin provisions the <code>@gleanql/client</code> runtime, runs{" "}
      <code>@gleanql/codegen</code> from the schema, compiles the route files with <code>@gleanql/compiler</code>, and emits a
      real <strong><code>@gleanql/client</code></strong> package into <code>node_modules</code> whose <code>package.json</code>{" "}
      <code>exports</code> declare the generated types. So app code imports by package name — no tsconfig paths, no alias:</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"import"}</span>{" { glean } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client\""}</span>{";\n"}<span className="k">{"import type"}</span>{" { Product } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client/schema\""}</span>{";"}</code></pre>
      <p>Two routes (a list <code>/collections/:handle</code> and a detail <code>/products/:handle</code>) compile to two
      operations; components live in separate files and the compiler follows the imports. Verified end-to-end on real
      workerd, including client hydration in the browser.</p>

      <h2>In-CI worker (no workerd)</h2>
      <p><code>examples/storefront/rwsdk-app/</code> is a RedwoodSDK-<em>shaped</em> worker (<code>defineApp</code>/{" "}
      <code>route</code>/<code>Document</code> from a local shim, since real <code>rwsdk/worker</code> needs workerd) that
      runs in the test suite — <code>worker.fetch(request)</code> → an HTML <code>Response</code> with the rendered page +
      hydration payload. It gives CI coverage of the integration without the workerd toolchain.</p>

      <h2>Status</h2>
      <p>Reads <em>and</em> writes are complete end-to-end: <code>examples/storefront/rwsdk.test.ts</code> drives the{" "}
      <em>real</em> compiler output for <code>ProductRoute.tsx</code> through the adapter — request → preload → proxy
      reads → serialize → hydrate — <code>packages/rwsdk/test/integration.test.ts</code> covers the mutation +
      optimistic + invalidation flow, and <code>rwsdk-app/worker.test.ts</code> runs the whole thing as a{" "}
      <code>fetch</code> handler. RSC-native serialization now ships too — the snapshot rides the flight stream and folds
      into a long-lived runtime — verified end-to-end on real workerd in <code>examples/rwsdk-real</code>.</p>

      <footer>Back to <a href="/index.html">Overview</a> · the runtime that powers this: <a href="/runtime.html">@gleanql/client</a>.</footer>
    </DocsLayout>
  );
}
