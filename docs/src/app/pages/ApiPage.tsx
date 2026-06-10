import { DocsLayout } from "../layout";

export function ApiPage() {
  return (
    <DocsLayout active="api.html">
      <title>API reference · glean</title>
      <h1>API reference</h1>
      <p className="lede">A condensed index of the main exports per package. See each package page for prose.</p>

      <h2><code>@gleanql/core</code></h2>
      <table>
        <tr><th>Export</th><th>Kind</th><th>Summary</th></tr>
        <tr><td><code>q</code></td><td>builder</td><td><code>operation, query, select, field, scalar, inlineFragment, var, literal, enumValue, list, object, args</code></td></tr>
        <tr><td><code>mergeSelectionSets(sets, schema, opts?)</code></td><td>fn</td><td>merge contributions on one type</td></tr>
        <tr><td><code>mergeOperations(name, ops, schema)</code></td><td>fn</td><td>merge whole operations at the root</td></tr>
        <tr><td><code>printOperation(op, opts?)</code></td><td>fn</td><td>IR → GraphQL document; <code>opts.fragments</code> (off by default) extracts repeated identical sub-selections into named fragments (<code>&#123; minUses?, minSelections? &#125;</code>)</td></tr>
        <tr><td><code>printArgs / printArgValue</code></td><td>fn</td><td>argument printing</td></tr>
        <tr><td><code>canonicalArgs / argAliasSuffix</code></td><td>fn</td><td>dedupe identity &amp; alias suffix</td></tr>
        <tr><td><code>defineSchema(init)</code> · <code>SchemaModel</code></td><td>class/fn</td><td>schema model</td></tr>
        <tr><td><code>hashDocument(doc)</code> · <code>sha256Hex(s)</code></td><td>fn</td><td>sha-256 hex — the persisted-operation ID (dependency-free, env-agnostic)</td></tr>
        <tr><td><code>renderReadMapTree / summarizeOperation</code></td><td>fn</td><td>devtools</td></tr>
        <tr><td><code>buildQuery(name, vars, build)</code></td><td>fn</td><td>fluent escape hatch</td></tr>
        <tr><td><code>OperationIR, SelectionSet, FieldSelection, ArgValue, OperationArtifact, ReadMap</code></td><td>types</td><td>IR &amp; artifact</td></tr>
      </table>

      <h2><code>@gleanql/compiler</code></h2>
      <table>
        <tr><th>Export</th><th>Kind</th><th>Summary</th></tr>
        <tr><td><code>analyzeWithTs(&#123; fileName, supportDir, schema &#125;)</code></td><td>fn</td><td>build a TS backend + analyze one file</td></tr>
        <tr><td><code>analyzeFile(&#123; fileName, backend, schema &#125;)</code></td><td>fn</td><td>analyze against an existing backend</td></tr>
        <tr><td><code>TsBackend</code></td><td>class</td><td><code>GraphCompilerBackend</code> over <code>ts.Program</code></td></tr>
        <tr><td><code>GraphCompilerBackend</code></td><td>interface</td><td>type/symbol seam</td></tr>
        <tr><td><code>findUseMutationSites(root, ast)</code></td><td>fn</td><td>discover <code>useMutation</code> call-sites + their compiled op names (shared by analyzer and build transform; syntactic, checker-free)</td></tr>
        <tr><td><code>AnalyzeResult, Diagnostic, DiagnosticCode, UseMutationSite</code></td><td>types</td><td>analysis output</td></tr>
      </table>

      <h2><code>@gleanql/client</code> (runtime)</h2>
      <table>
        <tr><th>Export</th><th>Kind</th><th>Summary</th></tr>
        <tr><td><code>GraphRuntime</code></td><td>class</td><td><code>readField, seed, seedResult, invalidate, snapshot</code>; static <code>hydrate</code></td></tr>
        <tr><td><code>GraphCache</code></td><td>class</td><td>normalized + path storage; <code>recordKey, getField, merge, invalidate, snapshot</code>; field-level reactivity via <code>recordVersion / fieldVersion / trackedVersion</code>; reference-counted retention via <code>retain / isRetained</code> (mounted readers retain automatically; LRU eviction skips retained records); staleness-aware collection via <code>advanceEpoch / gc(&#123; keepEpochs? &#125;)</code></td></tr>
        <tr><td><code>normalizeValue / seedResult</code></td><td>fn</td><td>result → cache</td></tr>
        <tr><td><code>runMutation(opts)</code></td><td>fn</td><td>server-side mutation engine: execute → normalize result into the cache → <code>userErrors</code> + optimistic/rollback + invalidate; returns <code>MutationResult</code> (never rejects logical failures)</td></tr>
        <tr><td><code>createMutator(opts)</code></td><td>fn</td><td>bind a set of named mutations to a runtime/adapter → <code>BoundMutations</code></td></tr>
        <tr><td><code>runRoute(args)</code></td><td>fn</td><td>compute variables → execute → seed</td></tr>
        <tr><td><code>createFetchAdapter(opts)</code></td><td>fn</td><td>plain fetch transport (HTTP + SSE subscriptions); <code>persisted: true</code> sends operations by sha-256 hash (APQ shape) with a one-shot document retry on <code>PersistedQueryNotFound</code></td></tr>
        <tr><td><code>createPersistedResolver(operations, opts?)</code></td><td>fn</td><td>server-side persisted allowlist: request body → <code>&#123; kind: "ok", document &#125;</code> / <code>"not-found"</code> / <code>"rejected"</code>; <code>allowUnpersisted</code> opts out of rejection</td></tr>
        <tr><td><code>GraphClientEvent</code></td><td>type</td><td>the <code>onEvent</code> incident channel: <code>refresh-error | operation-error | mutation-error | subscription-error | persisted-retry | gc</code></td></tr>
        <tr><td><code>createGraphWsAdapter(&#123; client, extensions? &#125;)</code></td><td>fn</td><td>WebSocket transport over an injected <code>graphql-ws</code> client; drives <code>execute</code> + <code>subscribe</code></td></tr>
        <tr><td><code>GraphScope / bindScope(als?)</code></td><td>class/fn</td><td>request-scoped runtime; <code>bindScope</code> pairs it with the accessor's resolver</td></tr>
        <tr><td><code>GraphClientAdapter, GraphFrameworkAdapter, CompiledOperation, GraphRef, MissingFieldRead/Result</code></td><td>types</td><td>seams &amp; values</td></tr>
        <tr><td><code>MutationResult, UserError, RunMutationOptions, CreateMutatorOptions, BoundMutations</code></td><td>types</td><td>mutation engine values &amp; options</td></tr>
      </table>

      <h2><code>@gleanql/client/client</code> (generated hooks)</h2>
      <table>
        <tr><th>Export</th><th>Kind</th><th>Summary</th></tr>
        <tr><td><code>useGlean()</code></td><td>hook</td><td>the active graph; re-renders the caller fine-grained — only when a record it read this pass changes</td></tr>
        <tr><td><code>usePaginated(connection, &#123; merge &#125;?)</code></td><td>hook</td><td>→ <code>&#123; fetchMore, isLoading, error &#125;</code>; <code>fetchMore(args)</code> re-runs the connection's selection and merges the page (default concat, or via <code>merge</code>)</td></tr>
        <tr><td><code>useMutation(selector, options?)</code></td><td>hook</td><td>→ <code>[mutate, &#123; isLoading, data, error, userErrors &#125;]</code> — gqty-style, compile-time selector; <code>await mutate(vars)</code> runs the compiled op and folds the result into the cache. Options: <code>optimistic</code> (field writes), <code>optimisticRoots</code> (list-root membership, auto-rolled-back), <code>update</code>, <code>invalidate</code>, <code>onCompleted</code>/<code>onError</code></td></tr>
        <tr><td><code>useSubscription(selector, options?)</code></td><td>hook</td><td>→ <code>&#123; data, error &#125;</code> — gqty-style, compile-time selector; opens the adapter's <code>subscribe</code> stream (SSE by default) and folds each push into the cache</td></tr>
        <tr><td><code>refresh(target?)</code></td><td>fn</td><td>refetch the current page operation, a named op, or a component slice (<code>&#123; component &#125;</code>)</td></tr>
        <tr><td><code>runOperation(name, variables?)</code></td><td>fn</td><td>execute a named (compiled or registered) operation; <strong>fully typed</strong> by the generated <code>GleanOperations</code> interface (variables AND result shape per name); seeds the normalized cache; rides the persisted hash</td></tr>
        <tr><td><code>appendToRoot(field, entity, &#123; prepend?, at? &#125;?)</code></td><td>fn</td><td>splice an entity into a list root's membership without a refetch; seeds a client-built entity's fields for optimistic UI</td></tr>
        <tr><td><code>removeFromRoot(field, entity)</code></td><td>fn</td><td>remove an entity from a list root's membership without a refetch (inverse of <code>appendToRoot</code>)</td></tr>
        <tr><td><code>UseMutationOptions, MutationState, MutationResult, UserError, UsePaginatedOptions, UsePaginatedResult, UseSubscriptionOptions, SubscriptionState</code></td><td>types</td><td>hook options &amp; result shapes</td></tr>
      </table>
      <p>These are emitted into <code>@gleanql/client/client</code> by the vite plugin as thin shims over <code>createGraphClient</code>; <code>useMutation</code>/<code>useSubscription</code>/<code>usePaginated</code> are emitted only when the schema/usage warrants.</p>

      <h2><code>@gleanql/vite</code></h2>
      <table>
        <tr><th>Export</th><th>Kind</th><th>Summary</th></tr>
        <tr><td><code>glean(&#123; schema, routes, requestScope? &#125;)</code></td><td>fn</td><td>the vite plugin: generates the schema into <code>@gleanql/client</code></td></tr>
        <tr><td><code>GraphPluginOptions</code></td><td>type</td><td><code>&#123; schema; routes?; endpoint?; framework?; backend?; maxCacheRecords?; strict?; persisted?; gcKeepPages?; operations? &#125;</code></td></tr>
        <tr><td><code>renderDevtoolsHtml(operations, diagnostics)</code></td><td>fn</td><td>the <code>/__glean</code> dev overlay page (served automatically by the plugin in dev)</td></tr>
        <tr><td><code>RequestScope</code></td><td>type</td><td><code>"rwsdk" | &#123; import; from &#125;</code> — how the accessor finds the active runtime</td></tr>
      </table>

      <footer>All exports are re-exported from each package's <code>src/index.ts</code>.</footer>
    </DocsLayout>
  );
}
