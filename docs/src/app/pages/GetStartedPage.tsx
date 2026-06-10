import { DocsLayout } from "../layout";

export function GetStartedPage() {
  return (
    <DocsLayout active="get-started.html">
      <title>Get started · glean</title>
      <h1>Get started</h1>
      <p className="lede">From zero to a compiled, cached, persisted GraphQL page in five steps. You will not write a
      single GraphQL document.</p>

      <h2>1 · Install</h2>
      <p>Two packages: the runtime your app imports, and the build plugin that generates everything into it.</p>
{/* prettier-ignore */}
<pre><code>{"pnpm add @gleanql/client\npnpm add -D @gleanql/vite"}</code></pre>
      <p className="note"><strong>Pre-release note:</strong> until the first npm release lands, run Glean from the
      monorepo (clone + <code>pnpm install</code>; the examples show the full setup).</p>

      <h2>2 · Point the plugin at your schema</h2>
      <p>One plugin, one required option. Everything else — codegen, the compiler, the typed accessor, the persisted
      manifest — happens behind it on every build and dev start.</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"// vite.config.ts (RedwoodSDK)"}</span>{"\n"}<span className="k">{"import"}</span>{" { defineConfig } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"vite\""}</span>{";\n"}<span className="k">{"import"}</span>{" { redwood } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"rwsdk/vite\""}</span>{";\n"}<span className="k">{"import"}</span>{" { glean } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/vite\""}</span>{";\n\n"}<span className="k">{"export default"}</span>{" "}<span className="f">{"defineConfig"}</span>{"({\n  plugins: ["}<span className="f">{"glean"}</span>{"({ schema: "}<span className="s">{"\"./schema.graphql\""}</span>{" }), "}<span className="f">{"redwood"}</span>{"()],\n});"}</code></pre>
      <p>On React Router 7 (isomorphic SSR, no RSC), add the framework + a shared scope module — the{" "}
      <a href="/react-router.html">React Router page</a> shows the three-file setup:</p>
{/* prettier-ignore */}
<pre><code><span className="f">{"glean"}</span>{"({ schema: "}<span className="s">{"\"./schema.graphql\""}</span>{", framework: "}<span className="s">{"\"react-router\""}</span>{" })"}</code></pre>

      <h2>3 · Write a component — field access is the query</h2>
{/* prettier-ignore */}
<pre><code><span className="k">{"import"}</span>{" { glean } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client\""}</span>{";\n"}<span className="k">{"import type"}</span>{" { Product } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/client/schema\""}</span>{";\n\n"}<span className="k">{"export function"}</span>{" "}<span className="f">{"ProductPage"}</span>{"({ params }: { params: { handle: string } }) {\n  "}<span className="k">{"const"}</span>{" product = glean."}<span className="f">{"product"}</span>{"({ handle: params.handle });\n  "}<span className="k">{"return"}</span>{" (\n    <main>\n      <h1>{product.title}</h1>\n      <"}<span className="t">{"BuyBox"}</span>{" product={product} />\n    </main>\n  );\n}\n\n"}<span className="k">{"function"}</span>{" "}<span className="f">{"BuyBox"}</span>{"({ product }: { product: "}<span className="t">{"Product"}</span>{" }) {\n  "}<span className="k">{"const"}</span>{" price = product.priceRange.minVariantPrice;\n  "}<span className="k">{"return"}</span>{" <button>{price.amount} {price.currencyCode}</button>;\n}"}</code></pre>
      <p>The compiler follows the reads — through props, helpers, <code>.map</code> callbacks, islands — and emits{" "}
      <strong>one operation for the route</strong>, a variables factory bound to your route params, and a
      per-component read map. Anything it can't follow is a <em>build error</em>, never a silent under-fetch.</p>

      <h2>4 · Run it</h2>
{/* prettier-ignore */}
<pre><code>{"pnpm dev"}</code></pre>
      <p>Open your route — the page renders server-side from one compiled operation and hydrates with the cache
      warm. Then open <strong><code>/__glean</code></strong>: every operation the build compiled, its document,
      persisted hash, size stats, and which component reads which field. That page is the complete picture of what
      your app can put on the wire.</p>

      <h2>5 · Turn the production knobs (when you want them)</h2>
{/* prettier-ignore */}
<pre><code><span className="f">{"glean"}</span>{"({\n  schema: "}<span className="s">{"\"./schema.graphql\""}</span>{",\n  persisted: "}<span className="k">{"true"}</span>{",        "}<span className="c">{"// hash-only wire + server allowlist"}</span>{"\n  gcKeepPages: "}<span className="k">{"2"}</span>{",         "}<span className="c">{"// collect cache records stale for 2 navigations"}</span>{"\n  maxCacheRecords: "}<span className="k">{"5000"}</span>{",  "}<span className="c">{"// LRU capacity bound"}</span>{"\n  strict: "}<span className="k">{"true"}</span>{",           "}<span className="c">{"// any compiler diagnostic fails the build (CI)"}</span>{"\n  operations: "}<span className="s">{"\"./src/report-operations.ts\""}</span>{", "}<span className="c">{"// hand-built shapes, allowlisted too"}</span>{"\n});"}</code></pre>
      <p>Each knob is documented on the <a href="/vite.html">@gleanql/vite page</a>; none are required to start.</p>

      <h2>Where next</h2>
      <ul>
        <li><a href="/usage.html">Using Glean</a> — the task tour: mutations, optimistic UI, pagination, subscriptions, errors.</li>
        <li><a href="/comparison.html">vs Relay &amp; gqty</a> — why "declare once, resolved at build time" is a different animal.</li>
        <li><code>examples/rwsdk-real</code>, <code>examples/rwsdk-todo</code>, <code>examples/remix-real</code> — three bootable apps exercising everything above.</li>
      </ul>
    </DocsLayout>
  );
}
