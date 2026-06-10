import { DocsLayout } from "../layout";
import { Code } from "../code";

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
<Code lang="tsx">{`
import { introspectionFromSchema, buildSchema } from "graphql"; // or your live introspection
import { generateSchemaPackage } from "@gleanql/codegen";

const { schemaModel, types, graph } = generateSchemaPackage(
  introspectionFromSchema(buildSchema(sdl)).__schema,
  { scalarTypes: { DateTime: "string", Decimal: "string" } }, // custom scalars
);
// write schemaModel → graph/schema-model.ts, types → graph/schema.ts, graph → graph/graph.ts
`}</Code>

      <h2>Why branded types</h2>
      <p>To app code these read as ordinary schema types; the compiler recognizes them via the{" "}
      <code>__typename</code> brand. Because nullability and lists are rendered exactly, TypeScript catches API
      drift before runtime:</p>
<Code lang="tsx">{`
export interface Product {
  __typename: "Product";
  title: string;                 // String!  → non-null
  descriptionHtml: string | null; // String   → nullable
  featuredImage: Image | null;
  images(args: { first: number }): Image[]; // [Image!]! + field args → callable
}

// product.title now fails to compile if the API drops or renames \`title\`.
`}</Code>

      <h2>Loop closure</h2>
      <p>The generator is decoupled from graphql-js — it just transforms the introspection JSON (structural types).
      The whole loop is verified end-to-end: a GraphQL schema → generated <code>SchemaModel</code> → the{" "}
      <em>real</em> compiler on <code>ProductRoute.tsx</code> → the byte-identical acceptance operation
      (<code>examples/storefront/codegen.test.ts</code>).</p>

      <footer>Back to <a href="/index.html">Overview</a> · how the model is used: <a href="/compiler.html">@gleanql/compiler</a>.</footer>
    </DocsLayout>
  );
}
