import { DocsLayout } from "../layout";

export function CodegenPage() {
  return (
    <DocsLayout active="codegen.html">
      <title>@gleanql/codegen · glean</title>
      <h1><code>@gleanql/codegen</code></h1>
      <p className="lede">Schemas are not hand-authored. Point the generator at a GraphQL introspection result and it emits
      the three files the rest of the system consumes — the machine-generated equivalents of what you'd otherwise
      write by hand.</p>

      <h2>Inputs &amp; outputs</h2>
      <table>
        <tr><th>Output</th><th>What it is</th></tr>
        <tr><td><code>schema-model.ts</code></td><td>the <code>SchemaModel</code> the compiler + runtime read (root fields, identity, lists, callable fields, union possible-types)</td></tr>
        <tr><td><code>schema.ts</code></td><td>branded TS types — literal <code>__typename</code>, accurate nullability/lists, callable fields as methods, enums/unions/interfaces/inputs</td></tr>
        <tr><td><code>graph.ts</code></td><td>the <code>glean.product(&#123; handle &#125;)</code> accessors + <code>components(...)</code></td></tr>
      </table>

      <h2>Usage</h2>
{/* prettier-ignore */}
<pre><code><span className="k">{"import"}</span>{" { introspectionFromSchema, buildSchema } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"graphql\""}</span>{"; "}<span className="c">{"// or your live introspection"}</span>{"\n"}<span className="k">{"import"}</span>{" { "}<span className="f">{"generateSchemaPackage"}</span>{" } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/codegen\""}</span>{";\n\n"}<span className="k">{"const"}</span>{" { schemaModel, types, graph } = "}<span className="f">{"generateSchemaPackage"}</span>{"(\n  introspectionFromSchema(buildSchema(sdl)).__schema,\n  { scalarTypes: { DateTime: "}<span className="s">{"\"string\""}</span>{", Decimal: "}<span className="s">{"\"string\""}</span>{" } }, "}<span className="c">{"// custom scalars"}</span>{"\n);\n"}<span className="c">{"// write schemaModel → graph/schema-model.ts, types → graph/schema.ts, graph → graph/graph.ts"}</span></code></pre>

      <h2>Why branded types</h2>
      <p>To app code these read as ordinary schema types; the compiler recognizes them via the{" "}
      <code>__typename</code> brand. Because nullability and lists are rendered exactly, TypeScript catches API
      drift before runtime:</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"export interface"}</span>{" "}<span className="t">{"Product"}</span>{" {\n  __typename: "}<span className="s">{"\"Product\""}</span>{";\n  title: string;                 "}<span className="c">{"// String!  → non-null"}</span>{"\n  descriptionHtml: string | null; "}<span className="c">{"// String   → nullable"}</span>{"\n  featuredImage: "}<span className="t">{"Image"}</span>{" | null;\n  images(args: { first: number }): "}<span className="t">{"Image"}</span>{"[]; "}<span className="c">{"// [Image!]! + field args → callable"}</span>{"\n}\n\n"}<span className="c">{"// product.title now fails to compile if the API drops or renames `title`."}</span></code></pre>

      <h2>Loop closure</h2>
      <p>The generator is decoupled from graphql-js — it just transforms the introspection JSON (structural types).
      The whole loop is verified end-to-end: a GraphQL schema → generated <code>SchemaModel</code> → the{" "}
      <em>real</em> compiler on <code>ProductRoute.tsx</code> → the byte-identical acceptance operation
      (<code>examples/storefront/codegen.test.ts</code>).</p>

      <footer>Back to <a href="/index.html">Overview</a> · how the model is used: <a href="/compiler.html">@gleanql/compiler</a>.</footer>
    </DocsLayout>
  );
}
