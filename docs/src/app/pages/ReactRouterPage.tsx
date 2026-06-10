import { DocsLayout } from "../layout";

export function ReactRouterPage() {
  return (
    <DocsLayout active="react-router.html">
      <title>React Router integration · glean</title>
      <h1>React Router integration</h1>
      <p className="lede">The second built-in <a href="/vite.html">framework preset</a> (<code>framework: "react-router"</code>),
      alongside RedwoodSDK. It targets <strong>React Router 7 in framework mode</strong> — <em>isomorphic, non-RSC</em>{" "}
      SSR — and exists to prove the framework binding isn't RSC-specific: the same data layer drives a structurally
      different host. The real, bootable app is <code>examples/remix-real</code>{" "}
      (<code>pnpm --filter @example/remix-real dev</code>).</p>
      <div className="note"><strong>Isomorphic vs. RSC.</strong> RedwoodSDK is the RSC preset (server/client split; the snapshot
      rides the flight stream). React Router framework mode renders the <em>same</em> route component on the server (SSR)
      and the client (hydration + navigation) — there is no <code>"use client"</code> boundary. So the{" "}
      <code>react-router</code> preset emits <em>no</em> server-component glue and <em>no</em> route transform; the snapshot
      travels on React Router's own loader-data channel.</div>

      <h2>The one seam: a shared scope</h2>
      <p>Because a route component runs in both bundles, <code>glean.product(...)</code> must resolve to <em>one runtime
      per environment</em> that the generated <code>useGlean()</code> and hydration also share. That is a single{" "}
      <code>GraphScope</code>: on the server an <code>AsyncLocalStorage</code> isolates concurrent requests; on the client
      it is a singleton. The app exposes a <strong>universal</strong>, client-safe scope module (no{" "}
      <code>node:async_hooks</code>) — the <code>requestScope</code> the generated accessor and client glue resolve from:</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"// app/graph-scope.ts — UNIVERSAL (loads in both bundles)"}</span>{"\n"}<span className="k">{"import"}</span>{" { GraphScope } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client\""}</span>{";\n"}<span className="k">{"export const"}</span>{" scope = "}<span className="k">{"new"}</span>{" "}<span className="f">{"GraphScope"}</span>{"();          "}<span className="c">{"// client: singleton"}</span>{"\n"}<span className="k">{"export const"}</span>{" "}<span className="f">{"activeGraph"}</span>{" = () => scope."}<span className="f">{"current"}</span>{"();  "}<span className="c">{"// the accessor's resolver"}</span></code></pre>
{/* prettier-ignore */}
<pre><code><span className="c">{"// app/graph.server.ts — SERVER-ONLY (.server keeps node:async_hooks out of the client)"}</span>{"\n"}<span className="k">{"import"}</span>{" { AsyncLocalStorage } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"node:async_hooks\""}</span>{";\n"}<span className="k">{"import"}</span>{" { scope } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"~/graph-scope\""}</span>{";\nscope."}<span className="f">{"attachAls"}</span>{"("}<span className="k">{"new"}</span>{" "}<span className="f">{"AsyncLocalStorage"}</span>{"());        "}<span className="c">{"// upgrade the shared scope to per-request isolation"}</span>{"\n"}<span className="k">{"export const"}</span>{" integration = "}<span className="f">{"createGraphIntegration"}</span>{"({ schema, operations, adapter });"}</code></pre>

      <h2>Setup</h2>
      <p>One line wires the build (the preset scans <code>app/</code>, points the accessor at the scope module, and emits
      isomorphic client glue). <code>~</code> is the app alias; <code>ssr.noExternal</code> lets Vite apply that alias inside
      the generated glue (which lives in <code>node_modules</code>).</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"// vite.config.ts"}</span>{"\n"}<span className="k">{"export default"}</span>{" "}<span className="f">{"defineConfig"}</span>{"({\n  resolve: { alias: [{ find: /^~\\//, replacement: appDir + "}<span className="s">{"\"/\""}</span>{" }] },\n  ssr: { noExternal: ["}<span className="s">{"\"@gleanql/client\""}</span>{"] },\n  plugins: [\n    "}<span className="f">{"glean"}</span>{"({ schema: "}<span className="s">{"\"schema.graphql\""}</span>{", framework: "}<span className="s">{"\"react-router\""}</span>{", endpoint: "}<span className="s">{"\"/graphql\""}</span>{" }),\n    "}<span className="f">{"reactRouter"}</span>{"(),\n  ],\n});"}</code></pre>

      <h2>Per request — the loader→render handoff</h2>
      <p>A root <code>middleware</code> preloads the matched route's operation and wraps both the loaders <em>and</em> the
      document render in one <code>scope.run(...)</code>, so <code>glean.product(...)</code> resolves to this request's
      seeded runtime everywhere it's read. (Server-only export; React Router strips it — and its <code>graph.server</code>{" "}
      import — from the client bundle.)</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"// app/root.tsx"}</span>{"\n"}<span className="k">{"export const"}</span>{" middleware = [\n  "}<span className="k">{"async"}</span>{" ({ request }, next) => {\n    "}<span className="k">{"const"}</span>{" active = "}<span className="k">{"await"}</span>{" "}<span className="f">{"preloadForRequest"}</span>{"(request);   "}<span className="c">{"// integration.preload(...)"}</span>{"\n    "}<span className="k">{"return"}</span>{" active ? scope."}<span className="f">{"run"}</span>{"(active, () => "}<span className="f">{"next"}</span>{"()) : "}<span className="f">{"next"}</span>{"();\n  },\n];"}</code></pre>

      <h2>Serialize &amp; hydrate (loader data, not a script)</h2>
      <p>The root loader serializes this request's cache; React Router ships it as loader data on the initial HTML{" "}
      <em>and</em> every <code>.data</code> navigation. The root component folds it in <strong>during render</strong> — so
      child routes read warm on the very first hydration pass (no waterfall, no mismatch). On first load it builds the
      client runtime on the shared scope; later navigations merge the new snapshot
      (<code>absorbHydrationPayload</code>).</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"// app/root.tsx"}</span>{"\n"}<span className="k">{"export function"}</span>{" "}<span className="f">{"loader"}</span>{"() { "}<span className="k">{"return"}</span>{" { graphPayload: "}<span className="f">{"activePayload"}</span>{"() ?? "}<span className="k">{"null"}</span>{" }; }\n\n"}<span className="k">{"export default function"}</span>{" "}<span className="f">{"App"}</span>{"() {\n  "}<span className="k">{"const"}</span>{" { graphPayload } = "}<span className="f">{"useLoaderData"}</span>{"();\n  "}<span className="f">{"hydrate"}</span>{"(graphPayload ?? "}<span className="k">{"undefined"}</span>{");   "}<span className="c">{"// build (first load) / merge (navigation); no-op on the server"}</span>{"\n  "}<span className="k">{"return"}</span>{" <"}<span className="f">{"Outlet"}</span>{" />;\n}"}</code></pre>

      <h2>Components &amp; islands</h2>
      <p>Route components read the graph directly — the same code on server and client:</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"import"}</span>{" { glean } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client\""}</span>{";\n"}<span className="k">{"export default function"}</span>{" "}<span className="f">{"Product"}</span>{"({ params }) {\n  "}<span className="k">{"const"}</span>{" product = glean."}<span className="f">{"product"}</span>{"({ handle: params.handle });   "}<span className="c">{"// warm: SSR + client"}</span>{"\n  "}<span className="k">{"return"}</span>{" <"}<span className="f">{"ProductHero"}</span>{" product={product} />;\n}"}</code></pre>
      <p>Client-interactive bits are ordinary components (no <code>"use client"</code>). The generated{" "}
      <code>@gleanql/client/client</code> exposes <code>useGlean()</code> (the shared graph, re-rendering fine-grained — only
      on the records a component read) plus <code>usePaginated</code>, <code>useMutation</code>, and <code>refresh</code>.{" "}
      <code>useGlean()</code> and the <code>glean</code> accessor resolve the same runtime, so there is no hydration
      mismatch.</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"import"}</span>{" { useGlean, refresh } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client/client\""}</span>{";\n\n"}<span className="k">{"const"}</span>{" glean = "}<span className="f">{"useGlean"}</span>{"();\n"}<span className="k">{"const"}</span>{" views = glean?."}<span className="f">{"product"}</span>{"({ handle }).views;\n"}<span className="c">{"// bare refresh() inside a component → the build binds it to this component's"}</span>{"\n"}<span className="c">{"// read-map, refetching ONLY product.views — a pruned query, not the whole page op"}</span>{"\n<button onClick={() => "}<span className="f">{"refresh"}</span>{"()}>Refresh</button>"}</code></pre>
      <p><code>refresh("OpName")</code> (or bare <code>refresh()</code> outside a component) re-runs a whole operation;
      a component-bound <code>refresh()</code> re-runs the page's root with a selection pruned to that component's
      read-map (+ identity), so the wire fetches a slice. Both re-seed the normalized cache, which reconciles by identity
      and re-renders only the components whose records changed. See <a href="/runtime.html">@gleanql/client</a>.</p>

      <h2>The real app — zero glue</h2>
      <p><code>examples/remix-real/</code> is a genuine React Router 7 app that boots. It commits <strong>no graph
      glue</strong> beyond the two tiny scope modules above — schema, routes/components, a transport, and the one{" "}
      <code>vite.config.ts</code> line. The build provisions <code>@gleanql/client</code> into <code>node_modules</code> and
      the app imports by package name:</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"import"}</span>{" { glean } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client\""}</span>{";\n"}<span className="k">{"import type"}</span>{" { Product } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client/schema\""}</span>{";"}</code></pre>
      <p>Two routes (<code>/collections/:handle</code>, <code>/products/:handle</code>) compile to two operations; a{" "}
      <code>/graphql</code> resource route serves client refetch. Verified end-to-end: SSR warm reads, the snapshot on the
      loader-data stream (initial + per-navigation <code>.data</code>), field-level refetch, and an{" "}
      <code>async_hooks</code>-free client bundle (the <code>.server</code> module is pruned).</p>

      <h2>Why it works without an adapter package</h2>
      <p>Everything framework-specific is the preset (<a href="/vite.html">@gleanql/vite</a>) plus the two app scope modules.{" "}
      <code>@gleanql/client</code> itself is unchanged — it only cares about the <code>requestScope</code> seam and the{" "}
      <code>GraphScope</code> (server ALS via <code>attachAls</code>, client singleton). No new runtime code was needed to
      add a structurally different framework, which is the point of the exercise.</p>

      <footer>Back to <a href="/index.html">Overview</a> · the build wiring: <a href="/vite.html">@gleanql/vite</a> · the RSC
      counterpart: <a href="/rwsdk.html">RedwoodSDK</a>.</footer>
    </DocsLayout>
  );
}
