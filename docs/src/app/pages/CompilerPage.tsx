import { DocsLayout } from "../layout";
import { Code } from "../code";

export function CompilerPage() {
  return (
    <DocsLayout active="compiler.html">
      <title>@gleanql/compiler · glean</title>
      <h1><code>@gleanql/compiler</code></h1>
      <p className="lede">Type-analyzes React/TypeScript source, follows prop flow, and extracts the graph read paths
      that become the operation — behind a swappable backend seam.</p>

      <h2>Entry points</h2>
<Code lang="tsx">{`
// one-shot convenience (builds a backend, analyzes one file)
analyzeWithTs({ fileName, supportDir, schema }) → AnalyzeResult

// long-lived backend (used by the Vite plugin)
const backend = new TsBackend({ fileNames, supportDir });
analyzeFile({ fileName, backend, schema }) → AnalyzeResult

interface AnalyzeResult {
  operations: readonly OperationArtifact[]; // one per route entrypoint
  readMap: ReadMap;                       // merged across the file
  diagnostics: readonly Diagnostic[];
}
`}</Code>

      <h2>How graph types are recognized</h2>
      <p>A type is graph-backed if it has a literal <code>__typename</code> property — which is genuinely the
      GraphQL <code>__typename</code> of an object. So userland types are plain interfaces, no special brand symbol:</p>
<Code lang="tsx">{`
interface Product {
  __typename: "Product";   // ← the brand the backend reads
  id: string; title: string; featuredImage: Image | null; …
}
type SearchResultItem = Product | Collection; // union → ["Product","Collection"]
`}</Code>
      <p>The <code>TsBackend</code> reads the literal(s) via a real <code>ts.TypeChecker</code>; a union yields multiple
      names (used for <code>__typename</code> narrowing). Field <em>types</em> for nested walking come from the
      schema model, which is authoritative about list-ness, arguments, and identity.</p>
      <p>Every type/symbol question goes through <code>GraphCompilerBackend</code>, so the engine is swappable.{" "}
      <code>createBackend("typescript", …)</code> builds the in-process <code>TsBackend</code>; an{" "}
      <em>experimental</em> Go-native engine ships behind the same seam — <code>createTsgoBackend(…)</code> drives
      the same <code>analyzeFile</code> walker over <code>@typescript/native-preview</code>'s AST + checker via an
      engine-agnostic <code>AstFacade</code>. The dependency is optional and dynamically imported (pre-release).
      The <a href="/vite.html">Vite plugin</a> selects between them with{" "}
      <code>backend: "typescript" | "tsgo"</code> and falls back to <code>typescript</code> if tsgo can't be
      resolved.</p>

      <h2>The analyzer</h2>
{/* prettier-ignore */}
<div className="flow">{`indexComponents     top-level functions / arrow consts with a graph-typed param
indexRegistries     module-level \`const x = glean.components({…})\`
─ for each route (component containing glean.<root>) ─
  createRoot        glean.product({…}) → root field; args → variables factory
  walkStatement     bindings, if-narrowing, returns
  evalExpr          property/optional/element/call chains → GraphValue, records reads
  handleJsx         resolve component(s), bind graph props, recurse
─ standalone components (graph props, not reached by a route) ─
  read map + diagnostics only`}</div>

      <p>A <strong>GraphValue</strong> carries the current GraphQL type, the mutable selection node new reads attach
      to, a list flag, and a read-map base/path. Entering a component or a list-iteration callback resets the
      read-map base to the new entity type — which is why <code>filter((p) =&gt; p.availableForSale)</code> records{" "}
      <code>Product.availableForSale</code>, not the full <code>Collection.products.nodes…</code> path.</p>

      <h2>Supported subset (v1)</h2>
      <table>
        <tr><th>Pattern</th><th>Example</th></tr>
        <tr><td>direct prop flow</td><td><code>&lt;ProductCard product=&#123;product&#125; /&gt;</code></td></tr>
        <tr><td>cross-file components</td><td>imported components resolved via <code>tsconfig</code> aliases (<code>@/…</code>) or relative paths</td></tr>
        <tr><td>local helper functions</td><td><code>summary(product)</code> → reads inside <code>summary</code>'s body are tracked</td></tr>
        <tr><td>property &amp; optional chaining</td><td><code>product.featuredImage?.url</code></td></tr>
        <tr><td>aliases</td><td><code>const image = product.featuredImage; image?.url</code></td></tr>
        <tr><td>destructuring</td><td><code>const &#123; title, featuredImage &#125; = product</code></td></tr>
        <tr><td>scalar method calls</td><td><code>product.title.toUpperCase()</code> → reads <code>title</code></td></tr>
        <tr><td>object truthiness</td><td><code>if (!product.featuredImage)</code> → <code>featuredImage &#123; __typename &#125;</code></td></tr>
        <tr><td>callable fields</td><td><code>collection.products(&#123; first: 12 &#125;).nodes</code></td></tr>
        <tr><td>arg conflicts → aliases</td><td><code>products(&#123;first:12&#125;)</code> &amp; <code>products(&#123;first:24&#125;)</code></td></tr>
        <tr><td>lists</td><td><code>.map</code> / <code>.filter</code> / <code>.find</code> / <code>nodes[0]</code></td></tr>
        <tr><td>static dynamic component</td><td><code>const C = cond ? ProductCard : ProductRow</code></td></tr>
        <tr><td>component registry</td><td><code>glean.components(&#123; card, row &#125;)[view]</code></td></tr>
        <tr><td>union narrowing</td><td><code>if (node.__typename === "Product")</code> → inline fragments</td></tr>
        <tr><td>multiple roots</td><td>batched into one operation</td></tr>
        <tr><td>list root</td><td><code>glean.products().map(…)</code> — a top-level <code>[Product!]</code> root, no object wrapper</td></tr>
        <tr><td>mid-chain root</td><td><code>glean.board().todos</code> — the root is created mid-expression, not only when bound</td></tr>
        <tr><td>lazy boundary</td><td><code>&lt;GraphLazy&gt;…&lt;/GraphLazy&gt;</code> excluded from the initial op</td></tr>
      </table>

      <h2>Variables &amp; argument capture</h2>
      <p>Root-call arguments are lifted into operation variables and a generated factory.</p>
      <div className="two-col">
        <div>
          <div className="col-label">Simple — a pure context path</div>
<Code lang="tsx">{`
glean.product({ handle: params.handle })

// $handle; factory returns ctx.params.handle
export function getProductRouteVariables(ctx) {
  return { handle: ctx.params.handle };
}
`}</Code>
        </div>
        <div>
          <div className="col-label">Complex — transformed / lifted</div>
<Code lang="tsx">{`
const handle = params.handle.toLowerCase();
glean.product({ handle });

// $product_handle; factory reproduces the local
export function getProductRouteVariables(ctx) {
  const handle = ctx.params.handle.toLowerCase();
  return { product_handle: handle };
}
`}</Code>
        </div>
      </div>

      <h2>Dynamic components (tiers)</h2>
      <table>
        <tr><th>Tier</th><th>Handling</th></tr>
        <tr><td>1 · static conditional</td><td><code>cond ? A : B</code> — include the <em>union</em> of both components' reads.</td></tr>
        <tr><td>2 · typed registry</td><td><code>glean.components(&#123;…&#125;)[key]</code> — merge all members' reads (or one if <code>key</code> is a literal).</td></tr>
        <tr><td>3 · lazy registries</td><td>read manifests per module (deferred in v1).</td></tr>
        <tr><td>4 · truly unknown</td><td><code>&lt;Component /&gt;</code> from a prop — <span className="pill gray">diagnostic</span>.</td></tr>
      </table>

      <h2>Interfaces &amp; unions</h2>
      <p><code>node.__typename === "Product"</code> guards narrow the union; the analyzer emits inline fragments —
      fragments are generated internally, never authored by hand.</p>
<Code lang="tsx">{`
nodes {
  __typename
  ... on Product { __typename id title featuredImage { __typename url } }
  ... on Collection { __typename id title image { __typename url } }
}
`}</Code>

      <h2>Lazy boundaries</h2>
      <p>By default, statically reachable fields are eager — even behind conditionals. To defer, wrap in{" "}
      <code>&lt;GraphLazy&gt;</code>: reads inside are excluded from the initial operation and fall through to a
      runtime fetch when the boundary renders.</p>

      <h2>Diagnostics</h2>
      <p>Unsupported patterns produce clear, actionable messages (part of the golden output).</p>
      <table>
        <tr><th>Code</th><th>Trigger</th></tr>
        <tr><td><code>dynamic-field-access</code></td><td><code>product[fieldName]</code></td></tr>
        <tr><td><code>unresolved-dynamic-component</code></td><td><code>&lt;Component /&gt;</code> that can't be statically resolved</td></tr>
        <tr><td><code>graph-value-spread</code></td><td><code>&#123; ...product &#125;</code></td></tr>
        <tr><td><code>recursive-component</code></td><td>a component that renders itself with a graph prop</td></tr>
      </table>

      <footer>Next: <a href="/runtime.html">@gleanql/client</a> — seeding, Suspense, batching, hydration.</footer>
    </DocsLayout>
  );
}
