import { DocsLayout } from "../layout";

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
{/* prettier-ignore */}
<pre><code><span className="k">{"interface"}</span>{" "}<span className="t">{"OperationIR"}</span>{" {\n  kind: "}<span className="s">{"\"query\""}</span>{" | "}<span className="s">{"\"mutation\""}</span>{" | "}<span className="s">{"\"subscription\""}</span>{";\n  name: string;\n  variables: readonly { name: string; type: string }[];\n  selection: "}<span className="t">{"SelectionSet"}</span>{";\n}\n\n"}<span className="k">{"interface"}</span>{" "}<span className="t">{"SelectionSet"}</span>{" {\n  typeName: string;                       "}<span className="c">{"// GraphQL type this set is on"}</span>{"\n  fields: readonly "}<span className="t">{"FieldSelection"}</span>{"[];\n  inlineFragments?: readonly "}<span className="t">{"InlineFragment"}</span>{"[]; "}<span className="c">{"// ... on T { … }"}</span>{"\n}\n\n"}<span className="k">{"interface"}</span>{" "}<span className="t">{"FieldSelection"}</span>{" {\n  name: string;\n  alias?: string;                         "}<span className="c">{"// emitted only when present"}</span>{"\n  args?: "}<span className="t">{"ArgMap"}</span>{";\n  directives?: readonly "}<span className="t">{"Directive"}</span>{"[];\n  selection?: "}<span className="t">{"SelectionSet"}</span>{";            "}<span className="c">{"// object fields only"}</span>{"\n}\n\n"}<span className="k">{"type"}</span>{" "}<span className="t">{"ArgValue"}</span>{" =\n  | { kind: "}<span className="s">{"\"var\""}</span>{"; name: string }       "}<span className="c">{"// $handle"}</span>{"\n  | { kind: "}<span className="s">{"\"literal\""}</span>{"; value: … }\n  | { kind: "}<span className="s">{"\"enum\""}</span>{"; value: string }\n  | { kind: "}<span className="s">{"\"list\""}</span>{"; items: ArgValue[] }\n  | { kind: "}<span className="s">{"\"object\""}</span>{"; fields: [string, ArgValue][] };"}</code></pre>
      <p>Variable references (<code>q.var</code>) are how arbitrary argument expressions get lifted into the generated
      variables factory; literals are what allow argument-level dedupe.</p>

      <h2>The <code>q.*</code> builder</h2>
      <p>The compiler emits calls to these helpers (and there's a human-authored escape hatch using the same surface).{" "}
      <code>q.select</code> takes a record keyed by <em>response key</em> (the alias if aliased, else the field name);
      each value carries the real field name.</p>
{/* prettier-ignore */}
<pre><code>{"q."}<span className="f">{"operation"}</span>{"({ kind, name, variables, selection })\nq."}<span className="f">{"select"}</span>{"(typeName, { responseKey: fieldSelection, … }, inlineFragments?)\nq."}<span className="f">{"field"}</span>{"(name, { args?, directives?, selection?, alias? })\nq."}<span className="f">{"scalar"}</span>{"(name, { args?, directives?, alias? })\nq."}<span className="f">{"inlineFragment"}</span>{"(onType, selection)\nq."}<span className="f">{"var"}</span>{"(name) · q."}<span className="f">{"literal"}</span>{"(v) · q."}<span className="f">{"enumValue"}</span>{"(v) · q."}<span className="f">{"list"}</span>{"([…]) · q."}<span className="f">{"object"}</span>{"(argMap) · q."}<span className="f">{"args"}</span>{"({…})"}</code></pre>

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
{/* prettier-ignore */}
<pre><code><span className="c">{"// these dedupe → one `title`"}</span>{"\nproduct.title; product.title;\n\n"}<span className="c">{"// these merge → featuredImage { url altText }"}</span>{"\nproduct.featuredImage?.url; product.featuredImage?.altText;"}</code></pre>

      <h3>2 · Argument conflicts → aliases</h3>
      <p>Same field name, different args, both present ⇒ both get a generated alias <code>$&#123;name&#125;_$&#123;suffix&#125;</code>{" "}
      where the suffix is derived deterministically from the arguments.</p>
{/* prettier-ignore */}
<pre><code>{"collection.products({ first: 12 })   "}<span className="c">{"// products_first12: products(first: 12)"}</span>{"\ncollection.products({ first: 24 })   "}<span className="c">{"// products_first24: products(first: 24)"}</span></code></pre>
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

{/* prettier-ignore */}
<pre><code>{"mergeSelectionSets(sets, schema, { isRoot? })  "}<span className="c">{"// merge contributions on one type"}</span>{"\nmergeOperations(name, ops, schema)             "}<span className="c">{"// merge whole operations (root not given identity)"}</span></code></pre>
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
{/* prettier-ignore */}
<pre><code>{"schema."}<span className="f">{"getField"}</span>{"(typeName, fieldName)   "}<span className="c">{"// → { type, list?, nonNull?, args? }"}</span>{"\nschema."}<span className="f">{"hasId"}</span>{"(typeName)                 "}<span className="c">{"// has a scalar `id`?"}</span>{"\nschema."}<span className="f">{"isLeaf"}</span>{"(typeName)                "}<span className="c">{"// scalar/enum"}</span>{"\nschema."}<span className="f">{"isObjectLike"}</span>{"(typeName)          "}<span className="c">{"// object/interface/union"}</span>{"\nschema."}<span className="f">{"isUnionOrInterface"}</span>{"(typeName)\nschema."}<span className="f">{"possibleTypes"}</span>{"(typeName)         "}<span className="c">{"// union members"}</span>{"\nschema."}<span className="f">{"getRootField"}</span>{"(name)"}</code></pre>

      <h2>Operation artifact</h2>
      <p>A compiled operation bundles more than the document — this is what a framework adapter loads to drive a route.</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"interface"}</span>{" "}<span className="t">{"OperationArtifact"}</span>{" {\n  name: string;\n  kind: "}<span className="s">{"\"query\""}</span>{" | "}<span className="s">{"\"mutation\""}</span>{" | "}<span className="s">{"\"subscription\""}</span>{";\n  document: string;                              "}<span className="c">{"// printed GraphQL"}</span>{"\n  hash: string;                                  "}<span className="c">{"// FNV-1a, for persisted queries / devtools"}</span>{"\n  variablesFactory: { exportName: string; source: string };\n  readMap: Record<string, readonly string[]>;    "}<span className="c">{"// component → [\"Type.path\", …]"}</span>{"\n  source?: string;                               "}<span className="c">{"// originating module"}</span>{"\n  stats: { fieldCount; rootCount; connectionCount };\n}"}</code></pre>

      <h2>Devtools</h2>
      <p><code>renderReadMapTree(name, readMap)</code> prints the per-component read tree;{" "}
      <code>summarizeOperation(...)</code> flags large/expensive operations (field/root/connection counts + the
      largest contributing component).</p>
{/* prettier-ignore */}
<pre><code>{`ProductRoute query
  ProductHero
    Product.title
    Product.featuredImage.url
  BuyBox
    Product.priceRange.minVariantPrice.amount
    Product.priceRange.minVariantPrice.currencyCode`}</code></pre>

      <h2>Human-authored escape hatch</h2>
      <p>Normal app code relies on compiler extraction. For the rare hand-written operation, <code>buildQuery</code>{" "}
      offers a fluent, schema-free builder: scalar fields are read as properties, object fields are called with a
      selection callback, and the variables proxy yields <code>$var</code> references. Output is printed verbatim
      (no identity injection — the author controls the exact selection).</p>
{/* prettier-ignore */}
<pre><code><span className="f">{"buildQuery"}</span>{"("}<span className="s">{"\"ProductQuery\""}</span>{", { handle: "}<span className="s">{"\"String!\""}</span>{" }, (root, $) => ({\n  product: root."}<span className="f">{"product"}</span>{"({ handle: $.handle }, (p) => ({\n    title: p.title,\n    featuredImage: p."}<span className="f">{"featuredImage"}</span>{"((image) => ({ url: image.url })),\n  })),\n}));"}</code></pre>

      <h2>Directives</h2>
      <p>The IR can express directives (<code>@include</code>/<code>@skip</code> and contextual ones) even though v1
      exposes no public directive API. They survive merging and printing:</p>
{/* prettier-ignore */}
<pre><code>{`descriptionHtml @include(if: $expanded)`}</code></pre>

      <footer>Next: <a href="/compiler.html">@gleanql/compiler</a> — how reads &amp; prop flow are extracted from source.</footer>
    </DocsLayout>
  );
}
