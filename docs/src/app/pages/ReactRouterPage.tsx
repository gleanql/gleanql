import { DocsLayout } from "../layout";
import { Code } from "../code";

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
<Code lang="tsx">{`
// app/graph-scope.ts — UNIVERSAL (loads in both bundles)
import { GraphScope } from "@gleanql/client";
export const scope = new GraphScope();          // client: singleton
export const activeGraph = () => scope.current();  // the accessor's resolver
`}</Code>
<Code lang="tsx">{`
// app/graph.server.ts — SERVER-ONLY (.server keeps node:async_hooks out of the client)
import { AsyncLocalStorage } from "node:async_hooks";
import { scope } from "~/graph-scope";
scope.attachAls(new AsyncLocalStorage());        // upgrade the shared scope to per-request isolation
export const integration = createGraphIntegration({ schema, operations, adapter });
`}</Code>

      <h2>Setup</h2>
      <p>One line wires the build (the preset scans <code>app/</code>, points the accessor at the scope module, and emits
      isomorphic client glue). <code>~</code> is the app alias; <code>ssr.noExternal</code> lets Vite apply that alias inside
      the generated glue (which lives in <code>node_modules</code>).</p>
<Code lang="tsx">{`
// vite.config.ts
export default defineConfig({
  resolve: { alias: [{ find: /^~\\//, replacement: appDir + "/" }] },
  ssr: { noExternal: ["@gleanql/client"] },
  plugins: [
    glean({ schema: "schema.graphql", framework: "react-router", endpoint: "/graphql" }),
    reactRouter(),
  ],
});
`}</Code>

      <h2>Per request — the loader→render handoff</h2>
      <p>A root <code>middleware</code> preloads the matched route's operation and wraps both the loaders <em>and</em> the
      document render in one <code>scope.run(...)</code>, so <code>glean.product(...)</code> resolves to this request's
      seeded runtime everywhere it's read. (Server-only export; React Router strips it — and its <code>graph.server</code>{" "}
      import — from the client bundle.)</p>
<Code lang="tsx">{`
// app/root.tsx
export const middleware = [
  async ({ request }, next) => {
    const active = await preloadForRequest(request);   // integration.preload(...)
    return active ? scope.run(active, () => next()) : next();
  },
];
`}</Code>

      <h2>Serialize &amp; hydrate (loader data, not a script)</h2>
      <p>The root loader serializes this request's cache; React Router ships it as loader data on the initial HTML{" "}
      <em>and</em> every <code>.data</code> navigation. The root component folds it in <strong>during render</strong> — so
      child routes read warm on the very first hydration pass (no waterfall, no mismatch). On first load it builds the
      client runtime on the shared scope; later navigations merge the new snapshot
      (<code>absorbHydrationPayload</code>).</p>
<Code lang="tsx">{`
// app/root.tsx
export function loader() { return { graphPayload: activePayload() ?? null }; }

export default function App() {
  const { graphPayload } = useLoaderData();
  hydrate(graphPayload ?? undefined);   // build (first load) / merge (navigation); no-op on the server
  return <Outlet />;
}
`}</Code>

      <h2>Components &amp; islands</h2>
      <p>Route components read the graph directly — the same code on server and client:</p>
<Code lang="tsx">{`
import { glean } from "@gleanql/client";
export default function Product({ params }) {
  const product = glean.product({ handle: params.handle });   // warm: SSR + client
  return <ProductHero product={product} />;
}
`}</Code>
      <p>Client-interactive bits are ordinary components (no <code>"use client"</code>). The generated{" "}
      <code>@gleanql/client/client</code> exposes <code>useGlean()</code> (the shared graph, re-rendering fine-grained — only
      on the records a component read) plus <code>usePaginated</code>, <code>useMutation</code>, and <code>refresh</code>.{" "}
      <code>useGlean()</code> and the <code>glean</code> accessor resolve the same runtime, so there is no hydration
      mismatch.</p>
<Code lang="tsx">{`
import { useGlean, refresh } from "@gleanql/client/client";

const glean = useGlean();
const views = glean?.product({ handle }).views;
// bare refresh() inside a component → the build binds it to this component's
// read-map, refetching ONLY product.views — a pruned query, not the whole page op
<button onClick={() => refresh()}>Refresh</button>
`}</Code>
      <p><code>refresh("OpName")</code> (or bare <code>refresh()</code> outside a component) re-runs a whole operation;
      a component-bound <code>refresh()</code> re-runs the page's root with a selection pruned to that component's
      read-map (+ identity), so the wire fetches a slice. Both re-seed the normalized cache, which reconciles by identity
      and re-renders only the components whose records changed. See <a href="/runtime.html">@gleanql/client</a>.</p>

      <h2>The real app — zero glue</h2>
      <p><code>examples/remix-real/</code> is a genuine React Router 7 app that boots. It commits <strong>no graph
      glue</strong> beyond the two tiny scope modules above — schema, routes/components, a transport, and the one{" "}
      <code>vite.config.ts</code> line. The build provisions <code>@gleanql/client</code> into <code>node_modules</code> and
      the app imports by package name:</p>
<Code lang="tsx">{`
import { glean } from "@gleanql/client";
import type { Product } from "@gleanql/client/schema";
`}</Code>
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
