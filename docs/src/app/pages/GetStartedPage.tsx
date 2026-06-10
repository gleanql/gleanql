import { DocsLayout } from "../layout";
import { Code } from "../code";

export function GetStartedPage() {
  return (
    <DocsLayout active="get-started.html">
      <title>Get started · glean</title>
      <h1>Get started</h1>
      <p className="lede">From zero to a compiled, cached, persisted GraphQL page in five steps. You will not write a
      single GraphQL document.</p>

      <h2>1 · Install</h2>
      <p>Two packages: the runtime your app imports, and the build plugin that generates everything into it.</p>
<Code lang="bash">{`
pnpm add @gleanql/client
pnpm add -D @gleanql/vite
`}</Code>
      <p className="note"><strong>Pre-release note:</strong> until the first npm release lands, run Glean from the
      monorepo (clone + <code>pnpm install</code>; the examples show the full setup).</p>

      <h2>2 · Point the plugin at your schema</h2>
      <p>One plugin, one required option. Everything else — codegen, the compiler, the typed accessor, the persisted
      manifest — happens behind it on every build and dev start.</p>
<Code lang="tsx">{`
// vite.config.ts (RedwoodSDK)
import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { glean } from "@gleanql/vite";

export default defineConfig({
  plugins: [glean({ schema: "./schema.graphql" }), redwood()],
});
`}</Code>
      <p>On React Router 7 (isomorphic SSR, no RSC), add the framework + a shared scope module — the{" "}
      <a href="/react-router.html">React Router page</a> shows the three-file setup:</p>
<Code lang="tsx">{`
glean({ schema: "./schema.graphql", framework: "react-router" })
`}</Code>

      <h2>3 · Write a component — field access is the query</h2>
<Code lang="tsx">{`
import { glean } from "@gleanql/client";
import type { Product } from "@gleanql/client/schema";

export function ProductPage({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main>
      <h1>{product.title}</h1>
      <BuyBox product={product} />
    </main>
  );
}

function BuyBox({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  return <button>{price.amount} {price.currencyCode}</button>;
}
`}</Code>
      <p>The compiler follows the reads — through props, helpers, <code>.map</code> callbacks, islands — and emits{" "}
      <strong>one operation for the route</strong>, a variables factory bound to your route params, and a
      per-component read map. Anything it can't follow is a <em>build error</em>, never a silent under-fetch.</p>

      <h2>4 · Run it</h2>
<Code lang="bash">{`
pnpm dev
`}</Code>
      <p>Open your route — the page renders server-side from one compiled operation and hydrates with the cache
      warm. Then open <strong><code>/__glean</code></strong>: every operation the build compiled, its document,
      persisted hash, size stats, and which component reads which field. That page is the complete picture of what
      your app can put on the wire.</p>

      <h2>5 · Turn the production knobs (when you want them)</h2>
<Code lang="tsx">{`
glean({
  schema: "./schema.graphql",
  persisted: true,        // hash-only wire + server allowlist
  gcKeepPages: 2,         // collect cache records stale for 2 navigations
  maxCacheRecords: 5000,  // LRU capacity bound
  strict: true,           // any compiler diagnostic fails the build (CI)
  operations: "./src/report-operations.ts", // hand-built shapes, allowlisted too
});
`}</Code>
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
