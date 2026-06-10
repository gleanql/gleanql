import { DocsLayout } from "../layout";
import { Code } from "../code";

export function CorePage() {
  return (
    <DocsLayout active="core.html">
      <title>@gleanql/core · glean</title>
      <h1><code>@gleanql/core</code></h1>
      <p className="lede">The framework-agnostic foundation: the query IR, the <code>q.*</code> builder, the selection
      merger, the GraphQL printer, the schema model, the operation artifact, and devtools.</p>

      <h2>Query IR</h2>
      <p>The compiler never emits GraphQL strings directly. It produces this IR, which is merged and then printed.
      Keeping an IR between extraction and printing is what enables dedupe-by-canonical-path, identity injection,
      and directives without string surgery.</p>
<Code lang="tsx">{`
interface OperationIR {
  kind: "query" | "mutation" | "subscription";
  name: string;
  variables: readonly { name: string; type: string }[];
  selection: SelectionSet;
}

interface SelectionSet {
  typeName: string;                       // GraphQL type this set is on
  fields: readonly FieldSelection[];
  inlineFragments?: readonly InlineFragment[]; // ... on T { … }
}

interface FieldSelection {
  name: string;
  alias?: string;                         // emitted only when present
  args?: ArgMap;
  directives?: readonly Directive[];
  selection?: SelectionSet;            // object fields only
}

type ArgValue =
  | { kind: "var"; name: string }       // $handle
  | { kind: "literal"; value: … }
  | { kind: "enum"; value: string }
  | { kind: "list"; items: ArgValue[] }
  | { kind: "object"; fields: [string, ArgValue][] };
`}</Code>
      <p>Variable references (<code>q.var</code>) are how arbitrary argument expressions get lifted into the generated
      variables factory; literals are what allow argument-level dedupe.</p>

      <h2>The <code>q.*</code> builder</h2>
      <p>The compiler emits calls to these helpers (and there's a human-authored escape hatch using the same surface).{" "}
      <code>q.select</code> takes a record keyed by <em>response key</em> (the alias if aliased, else the field name);
      each value carries the real field name.</p>
<Code lang="tsx">{`
q.operation({ kind, name, variables, selection })
q.select(typeName, { responseKey: fieldSelection, … }, inlineFragments?)
q.field(name, { args?, directives?, selection?, alias? })
q.scalar(name, { args?, directives?, alias? })
q.inlineFragment(onType, selection)
q.var(name) · q.literal(v) · q.enumValue(v) · q.list([…]) · q.object(argMap) · q.args({…})
`}</Code>

      <h2>The selection merger</h2>
      <p>Given any number of selection-set contributions over the same type (one per component read, or per
      dynamic-component candidate), <code>mergeSelectionSets</code> produces one canonical set.</p>

      <h3>1 · Dedupe identity</h3>
      <p>Two fields are "the same" — and merge their sub-selections — only when these are all equal:</p>
      <table>
        <tr><th>Component</th><th>Notes</th></tr>
        <tr><td>parent path</td><td>position in the tree</td></tr>
        <tr><td>field name</td><td></td></tr>
        <tr><td>canonical arguments</td><td>order-independent; <code>&#123;a:1,b:2&#125;</code> ≡ <code>&#123;b:2,a:1&#125;</code></td></tr>
        <tr><td>directives</td><td>canonicalized too</td></tr>
        <tr><td>result type</td><td>implied by parent type + name</td></tr>
      </table>
<Code lang="tsx">{`
// these dedupe → one \`title\`
product.title; product.title;

// these merge → featuredImage { url altText }
product.featuredImage?.url; product.featuredImage?.altText;
`}</Code>

      <h3>2 · Argument conflicts → aliases</h3>
      <p>Same field name, different args, both present ⇒ both get a generated alias <code>$&#123;name&#125;_$&#123;suffix&#125;</code>{" "}
      where the suffix is derived deterministically from the arguments.</p>
<Code lang="tsx">{`
collection.products({ first: 12 })   // products_first12: products(first: 12)
collection.products({ first: 24 })   // products_first24: products(first: 24)
`}</Code>
      <p>A field that appears only once keeps its bare name, even with arguments.</p>

      <h3>3 · Identity injection</h3>
      <p>Every <em>non-root</em> object selection gets <code>__typename</code>; types that expose an <code>id</code>{" "}
      field also get <code>id</code> — even if no component read them.</p>
      <div className="warn"><strong>Consistent rule.</strong> We always inject <code>__typename</code> for object
      selections, including pure-scalar leaf objects like <code>MoneyV2</code>. The brief's prose and its page-3
      example agree; one later snippet omits it on <code>MoneyV2</code> but keeps it on the structurally identical{" "}
      <code>Image</code> — an internal inconsistency we resolve in favor of consistency. See{" "}
      <a href="/decisions.html">Design decisions</a>.</div>

      <h3>4 · Deterministic order</h3>
      <p>Output order within a selection is: <code>__typename</code>, then <code>id</code>, then user fields in
      first-seen order. This is what makes golden output stable.</p>

<Code lang="tsx">{`
mergeSelectionSets(sets, schema, { isRoot? })  // merge contributions on one type
mergeOperations(name, ops, schema)             // merge whole operations (root not given identity)
`}</Code>
      <div className="note"><strong>Operation-level vs cache-level dedupe are separate.</strong> The merger does{" "}
      <em>operation-level</em> dedupe (merge identical query paths into one document). <em>Cache-level</em> dedupe
      (normalize entities by <code>__typename + id</code>) happens in the runtime.</div>

      <h2>GraphQL printer</h2>
      <p>The only place IR becomes a string. Deterministic two-space indentation; fields print in IR order (already
      canonicalized by the merger). <code>printOperation(op)</code>, plus <code>printArgs</code> / <code>printArgValue</code>.</p>

      <h2>Schema model</h2>
      <p>Just enough schema knowledge to resolve a field's type, know identity, distinguish leaf/object/union/list,
      and validate roots. Hand-authorable via <code>defineSchema(...)</code>; an introspection-driven generator can
      produce the same shape.</p>
<Code lang="tsx">{`
schema.getField(typeName, fieldName)   // → { type, list?, nonNull?, args? }
schema.hasId(typeName)                 // has a scalar \`id\`?
schema.isLeaf(typeName)                // scalar/enum
schema.isObjectLike(typeName)          // object/interface/union
schema.isUnionOrInterface(typeName)
schema.possibleTypes(typeName)         // union members
schema.getRootField(name)
`}</Code>

      <h2>Operation artifact</h2>
      <p>A compiled operation bundles more than the document — this is what a framework adapter loads to drive a route.</p>
<Code lang="tsx">{`
interface OperationArtifact {
  name: string;
  kind: "query" | "mutation" | "subscription";
  document: string;                              // printed GraphQL
  hash: string;                                  // FNV-1a, for persisted queries / devtools
  variablesFactory: { exportName: string; source: string };
  readMap: Record<string, readonly string[]>;    // component → ["Type.path", …]
  source?: string;                               // originating module
  stats: { fieldCount; rootCount; connectionCount };
}
`}</Code>

      <h2>Devtools</h2>
      <p><code>renderReadMapTree(name, readMap)</code> prints the per-component read tree;{" "}
      <code>summarizeOperation(...)</code> flags large/expensive operations (field/root/connection counts + the
      largest contributing component).</p>
<Code lang="tsx">{`
ProductRoute query
  ProductHero
    Product.title
    Product.featuredImage.url
  BuyBox
    Product.priceRange.minVariantPrice.amount
    Product.priceRange.minVariantPrice.currencyCode
`}</Code>

      <h2>Human-authored escape hatch</h2>
      <p>Normal app code relies on compiler extraction. For the rare hand-written operation, <code>buildQuery</code>{" "}
      offers a fluent, schema-free builder: scalar fields are read as properties, object fields are called with a
      selection callback, and the variables proxy yields <code>$var</code> references. Output is printed verbatim
      (no identity injection — the author controls the exact selection).</p>
<Code lang="tsx">{`
buildQuery("ProductQuery", { handle: "String!" }, (root, $) => ({
  product: root.product({ handle: $.handle }, (p) => ({
    title: p.title,
    featuredImage: p.featuredImage((image) => ({ url: image.url })),
  })),
}));
`}</Code>

      <h2>Directives</h2>
      <p>The IR can express directives (<code>@include</code>/<code>@skip</code> and contextual ones) even though v1
      exposes no public directive API. They survive merging and printing:</p>
<Code lang="tsx">{`
descriptionHtml @include(if: $expanded)
`}</Code>

      <footer>Next: <a href="/compiler.html">@gleanql/compiler</a> — how reads &amp; prop flow are extracted from source.</footer>
    </DocsLayout>
  );
}
