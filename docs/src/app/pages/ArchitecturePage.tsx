import { DocsLayout } from "../layout";

export function ArchitecturePage() {
  return (
    <DocsLayout active="architecture.html">
      <title>Architecture &amp; pipeline · glean</title>
      <h1>Architecture &amp; pipeline</h1>
      <p className="lede">From <code>.tsx</code> source to a validated GraphQL operation, step by step — and why the
      responsibilities are split the way they are.</p>

      <h2>Responsibility split</h2>
      <p>The system owns everything <em>about</em> the data graph; an existing client owns the wire.</p>
      <table>
        <tr><th>This system owns</th><th>A client/transport adapter owns</th></tr>
        <tr>
          <td>field-read extraction · selection/path model · operation generation · de-duping · batching ·
          read maps · graph value runtime · Suspense/cache behavior · normalization/invalidation</td>
          <td>HTTP transport · auth headers · request cancellation · retries · the subscription stream (SSE in-box,
          or graphql-ws) · network-level persisted queries</td>
        </tr>
      </table>

      <h2>The packages</h2>
      <table>
        <tr><th>Package</th><th>Responsibility</th></tr>
        <tr><td><code>@gleanql/core</code></td><td>Query IR, <code>q.*</code> builder, selection merger, GraphQL printer, schema model, operation artifact, devtools, fluent escape hatch.</td></tr>
        <tr><td><code>@gleanql/compiler</code></td><td><code>GraphCompilerBackend</code> seam, a <code>typescript</code> backend, and the analyzer.</td></tr>
        <tr><td><code>@gleanql/client</code></td><td>Client adapter, normalized/path cache, normalizer, Suspense runtime, route seam, and the React glue factories (<code>createGraphClient</code>/<code>createGraphServer</code>) the generated entrypoints shim over (<code>react</code> peer, &gt;=18).</td></tr>
        <tr><td><code>@gleanql/vite</code></td><td>The build plugin: generates the schema (<code>glean</code> accessor, types, operations) into <code>@gleanql/client</code>. Framework-specific decisions sit behind a <code>FrameworkPreset</code> seam; the core pipeline stays neutral.</td></tr>
      </table>

      <h2>The compile pipeline</h2>
{/* prettier-ignore */}
<div className="flow">{`1. discover   route entrypoints (functions that call glean.<root>) + components
2. anchor     each glean.product({…}) → a root field on the Query selection,
              arguments lifted into a variables factory
3. flow       follow JSX props: <ProductHero product={product} /> binds the
              child's \`product\` param to the same selection node
4. read       property/optional/alias/destructure/call reads attach fields to
              the mutable selection tree; leaf reads also land in the read map
5. normalize  core merger: dedupe by canonical path, alias arg-conflicts,
              inject __typename/id, order deterministically
6. print      core printer → GraphQL document (+ hash, stats)
7. emit       OperationArtifact { document, variablesFactory, readMap, … }`}</div>

      <h2>Worked example</h2>
      <p>Two components read different parts of the same <code>product</code>. Each contributes a partial selection;
      the merger combines them.</p>

      <div className="two-col">
        <div>
          <div className="col-label">ProductHero reads</div>
{/* prettier-ignore */}
<pre><code>{`Product.title
Product.featuredImage.url`}</code></pre>
        </div>
        <div>
          <div className="col-label">BuyBox reads</div>
{/* prettier-ignore */}
<pre><code>{`Product.priceRange
       .minVariantPrice.amount
Product.priceRange
       .minVariantPrice.currencyCode`}</code></pre>
        </div>
      </div>

      <p>The analyzer connects the root call to both components and emits one merged operation:</p>
{/* prettier-ignore */}
<pre><code>{`Query.product(handle: params.handle)
  ├─ ProductHero reads
  └─ BuyBox reads
        ▼  (one operation)
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
}`}</code></pre>

      <h2>Compiler vs. runtime authority (hybrid)</h2>
      <p>The compiler is authoritative for the <em>initial</em> operation; the runtime may fetch fields that were
      not statically reachable (lazy/dynamic paths). The mode is configurable:</p>
      <table>
        <tr><th>Mode</th><th>Behavior</th></tr>
        <tr><td><code>hybrid</code> <span className="pill green">v1 default</span></td><td>compiled query first; runtime misses allowed, warned in dev.</td></tr>
        <tr><td><code>strict</code></td><td>compiled query only; an unexpected runtime miss throws.</td></tr>
        <tr><td><code>runtime-first</code></td><td>runtime tracking is the source of truth; the compiler is an optimization.</td></tr>
      </table>
      <p>v1 implements <code>hybrid</code> and exposes <code>unexpectedMissingField: "allow" | "warn" | "error"</code>{" "}
      on the runtime to select the others.</p>

      <h2>The backend seam</h2>
      <p>The analyzer walks the TypeScript AST for <em>structure</em> but routes every <em>type/symbol</em> question
      through <code>GraphCompilerBackend</code>. The default ships a real <code>ts.Program</code> + <code>TypeChecker</code>.
      Because the seam is the only contact point for type info, a Go-based engine
      (tsgo / <code>@typescript/native-preview</code>) plugs in without touching analysis logic — it already does, as an
      experimental <code>backend</code> option.</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"interface"}</span>{" "}<span className="t">{"GraphCompilerBackend"}</span>{" {\n  getSourceFile(fileName): ts.SourceFile | "}<span className="k">{"undefined"}</span>{";\n  getGraphTypeNames(node): readonly string[] | "}<span className="k">{"undefined"}</span>{"; "}<span className="c">{"// union → many"}</span>{"\n  getGraphTypeName(node): string | "}<span className="k">{"undefined"}</span>{";\n  isGraphBackedType(node): boolean;\n  resolveDeclaration(node): ts.Declaration | "}<span className="k">{"undefined"}</span>{";\n}"}</code></pre>
      <p>The build creates <strong>one</strong> <code>ts.Program</code> over all files and analyzes each route against it
      (<code>analyzeFile</code> + a shared backend), instead of recreating a full program per route — O(routes × files)
      program builds collapse to one. Because all type/symbol queries still go through the seam, the engine stays
      swappable: the in-process <code>typescript</code> backend is the default, and an experimental Go-native{" "}
      <code>tsgo</code> backend (<code>@typescript/native-preview</code>) is selectable via the Vite plugin's{" "}
      <code>backend</code> option — same interface, much faster type-checking on large route sets, with a graceful
      fallback to <code>typescript</code> when the optional dep can't be resolved.</p>

      <footer>Next: <a href="/core.html">@gleanql/core</a> — the IR, merger, and printer that turn extracted reads into a document.</footer>
    </DocsLayout>
  );
}
