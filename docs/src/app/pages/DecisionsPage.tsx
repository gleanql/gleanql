import { DocsLayout } from "../layout";

export function DecisionsPage() {
  return (
    <DocsLayout active="decisions.html">
      <title>Design decisions · glean</title>
      <h1>Design decisions &amp; deviations</h1>
      <p className="lede">Where an implementation choice was non-obvious or departs from the brief, here's what was
      decided and why.</p>

      <h2>Consistent <code>__typename</code> injection</h2>
      <p>Every non-root object selection gets <code>__typename</code>; types exposing <code>id</code> also get{" "}
      <code>id</code>. The brief's prose ("include <code>__typename</code> when needed for existence/discrimination")
      and its page-3 example agree with this. A later snippet omits <code>__typename</code> on the pure-scalar{" "}
      <code>MoneyV2</code> <em>but keeps it on the structurally identical <code>Image</code></em> — an internal
      inconsistency. We chose the consistent rule, so generated documents include <code>__typename</code> on{" "}
      <code>MoneyV2</code> / <code>ProductConnection</code> too. Lives in <code>merger.ts</code>.</p>

      <h2><code>ttsc</code> backend = the <code>typescript</code> compiler API</h2>
      <p>The first backend uses a real <code>ts.Program</code> + <code>TypeChecker</code>. All type/symbol queries go
      through <code>GraphCompilerBackend</code>, so a Go-based engine
      (tsgo / <code>@typescript/native-preview</code> / Corsa) can replace it without touching analysis logic.{" "}
      <code>ts-morph</code> is intentionally not used (too slow, too far from the compiler path). The AST walking
      layer is the part a non-TS backend would re-target; type info is fully behind the seam.</p>

      <h2><code>graphql</code> (graphql-js) is a test-only dependency</h2>
      <p>It is used in tests as a <em>correctness oracle</em>: every generated operation is parsed and validated
      against an SDL form of the schema. It is not a runtime or transport dependency — the runtime owns cache
      identity and Suspense, as the brief requires (no overlapping normalized client cache).</p>

      <h2>Component-only brief examples are wrapped in a route</h2>
      <p>Several brief examples are bare components. In the golden fixtures they're wrapped in a thin route so each
      produces a full, validatable operation. The merging behavior exercised is identical.</p>

      <h2>Hybrid authority in v1</h2>
      <p>The compiler is authoritative for the initial operation; the runtime may fetch lazy/dynamic fields. v1
      implements <code>hybrid</code> and exposes <code>unexpectedMissingField: "allow" | "warn" | "error"</code> to
      reach <code>strict</code> / <code>runtime-first</code> behavior.</p>

      <h2>Mutations compile like reads — no schema convention in core</h2>
      <p>The client <code>useMutation</code> selector <em>defines</em> the operation: <code>(m, vars) =&gt;
      m.setProductTitle(vars).title</code> is rooted at the <code>Mutation</code> type and compiles to a{" "}
      <code>kind:"mutation"</code> op. The selector never runs at runtime — the build injects the compiled op name into the
      call site, exactly as <code>usePaginated</code> and <code>refresh()</code> have their target injected. This mirrors
      the project's standing line: runtime primitives over compiler magic, no Relay-style convention baked into the
      compiler/core. The engine (<code>runMutation</code> — normalize + optimistic + <code>userErrors</code> +
      invalidate) already existed for the server write side; this made mutations <em>compile</em> from a call-site
      selector and exposed a React hook (<code>[mutate, state]</code>) over the same engine.</p>

      <h2>List-root membership is a runtime primitive, not a compiler convention</h2>
      <p>A list root's membership (<code>glean.todos()</code>) lives in the page pointer's <code>roots</code> array, not in a
      normalized record — so adding/removing an element isn't a field change the cache reconciles by identity. The same
      "no convention in core" line applies: rather than a Relay-style <code>@appendNode</code> directive that teaches the
      compiler how a mutation mutates a list, membership is two plain runtime calls —{" "}
      <code>appendToRoot(field, entity, &#123; prepend?, at? &#125;)</code> / <code>removeFromRoot(field, entity)</code> — that rewrite{" "}
      <code>roots[field]</code> and bump the page epoch. They splice in place (no refetch), and <code>appendToRoot</code>{" "}
      seeds a client-built entity's fields so a row renders before the server responds. Generating the id client-side makes
      the optimistic row the final one (the mutation normalizes over the same identity, nothing to reconcile). It's the
      membership counterpart to <code>useMutation</code>'s optimistic <em>field</em> writes — you call it where you know the
      intent, instead of the compiler guessing it from a directive.</p>

      <h2>Fine-grained reactivity via version counters + an affected-key digest (valtio-style)</h2>
      <p>Rather than per-key subscription fan-out, the cache keeps <strong>version counters</strong>, reads are tracked per
      component (each render's binding collects the keys it touched), and the <code>useSyncExternalStore</code>{" "}
      tear-check compares a <em>digest of just those keys' versions</em> — so a global <code>notify()</code> re-renders
      only the components whose keys actually changed. Tracking is <strong>field-level</strong>: a read records the exact{" "}
      <code>record + field</code>, so two components reading different fields of the <em>same</em> entity don't wake each
      other. The cache keeps both per-field versions (for <code>useGlean</code>) and per-record versions
      (<code>usePaginated</code> watches a whole connection record); a write bumps the field <em>and</em> the record, and{" "}
      <code>trackedVersion</code> resolves each tracked key at its own granularity.{" "}
      <strong>Implementation subtlety:</strong> the external snapshot is a monotonic counter gated inside the subscriber,{" "}
      <em>not</em> the raw digest returned from <code>getSnapshot</code>. Returning the digest loops: reads happen <em>after</em>{" "}
      the hook runs, so the render-time snapshot is empty and the post-commit tear-check always diverges. The subscriber
      recomputes the digest on each notify, bumps the counter only when it changed, and an effect rebases the baseline to
      this render's reads. Attribution is <strong>per binding</strong>: <code>useGlean</code> binds the graph with its
      render's own <code>affected</code> set, so reads through that render's proxies record into it directly — fiber-local,
      safe under concurrent/interrupted rendering. (A module-global tracker survives only as a fallback for trackerless
      proxies — the server / isomorphic accessor — where no re-render depends on attribution.)</p>

      <h2>Subscriptions compile like mutations; transport stays behind the adapter</h2>
      <p>A <code>useSubscription((s, vars) =&gt; s.productChanged(vars).price)</code> selector compiles exactly like a
      mutation — rooted at the <code>Subscription</code> type, the build injects the op name — so the discovery, binding
      and analyzer paths are <em>shared</em> (one selector-hook code path, not two). The runtime hook drives the adapter's{" "}
      <code>subscribe</code> async-iterable and folds each pushed result into the normalized cache, so fine-grained
      reactivity re-renders only the readers of a changed record. <strong>Transport is the adapter's job, not the
      runtime's:</strong> the in-box fetch adapter implements <code>subscribe</code> over Server-Sent Events
      (<code>EventSource</code>), which needs no extra client library and streams fine for the example; a production app
      that prefers WebSockets passes a <code>graphql-ws</code> client to the built-in <code>createGraphWsAdapter</code> —
      same seam, no compile or hook changes. (graphql-ws carries every operation kind, so that one adapter drives both{" "}
      <code>execute</code> and <code>subscribe</code>.)</p>

      <h2>Deferred (per the brief's v1 non-goals)</h2>
      <ul>
        <li><strong>Lazy component <em>data</em></strong> — the <code>&lt;GraphLazy&gt;</code> <em>boundary</em> is
        wired (excluded fields fall through to runtime fetches); per-view lazy manifests are not.</li>
        <li><strong>Imported-helper body analysis — now SHIPPED.</strong> A graph value passed to an imported function
        (<code>formatPrice(product.priceRange.minVariantPrice)</code>) resolves through the type-checker, its body is
        walked, and its reads fold into the operation attributed to the helper's name — same for function references
        in <code>.map(renderRow)</code>. Unanalyzable callbacks fail the build with{" "}
        <code>unsupported-list-flow</code> rather than under-fetching.</li>
        <li><strong>Subscription auth / resume policy</strong> — the <code>graphql-ws</code> transport ships, but
        reconnect/resume semantics and per-subscription auth are left to the app's client config.</li>
      </ul>
      <div className="note">Since the original brief: mutations (server <code>runMutation</code> + the compile-time{" "}
      <code>useMutation</code> hook), subscriptions (<code>useSubscription</code> over SSE <em>and</em> the built-in{" "}
      <code>graphql-ws</code> transport), top-level list roots (<code>glean.todos()</code>), fiber-scoped read
      attribution, the RedwoodSDK and React Router adapters, connection pagination (<code>usePaginated</code>),
      fine-grained reactivity, persisted operations (sha-256 manifest + <code>persisted: true</code> wire mode +{" "}
      <code>createPersistedResolver</code> allowlist — live in <code>examples/rwsdk-real</code>), and
      reference-counted store retention (mounted readers pin what they read; <code>cache.gc()</code> sweeps the
      rest) all shipped — see the entries above.</div>

      <h2><code>@defer</code> / <code>@stream</code>: a decision, not (yet) a feature</h2>
      <p>Incremental delivery is deliberately <strong>not</strong> implemented, for two reasons.</p>
      <p><strong>The use-case is already covered, differently.</strong> What apps reach for <code>@defer</code> for —
      "render the page now, fill this expensive subtree later" — is what <code>&lt;GraphLazy&gt;</code> does: reads
      inside the boundary are <em>excluded</em> from the route operation and fetched on demand at runtime. Same UX
      (fast first paint, late subtree), different mechanics (two ordinary requests instead of one chunked
      response). RSC hosts add a second layer for free: Suspense streaming defers <em>rendering</em> server-side
      without GraphQL's involvement.</p>
      <p><strong>Implementing it today would ship dead code.</strong> Real <code>@defer</code> needs an
      incremental-delivery transport (<code>multipart/mixed</code> chunk parsing in the adapter), patch-application
      semantics in the cache (apply <code>incremental</code> payloads at their <code>path</code>), and — decisively —
      a server that can produce it: graphql-js only executes incremental delivery in the v17 alphas, and every
      example server here runs v16. There is nothing to verify end-to-end against, and unverifiable runtime code
      is how silent bugs ship.</p>
      <p>The pieces are staged for when the ecosystem lands: directives already exist in the IR and print
      correctly, the compiler could mark a <code>&lt;GraphLazy&gt;</code> boundary as <code>... @defer</code>{" "}
      instead of excluding it (one analyzer switch), and the cache's normalization already applies partial results.
      When graphql-js 17 stabilizes, the work is the adapter's chunk parser plus an integration test — not a
      redesign.</p>

      <h2>Testing strategy</h2>
      <p>Three layers: <strong>core unit tests</strong> (merger/printer/builder/devtools/fluent),{" "}
      <strong>golden fixtures</strong> (<code>input.tsx</code> → <code>expected.graphql</code> /{" "}
      <code>expected.variables.ts</code> / <code>expected.readmap.json</code> / <code>expected.diagnostics.json</code>,
      each generated op validated with graphql-js), and <strong>runtime tests</strong> (Suspense, batching, identity,
      seeding, hydration, invalidation, mutations, reactivity). 350+ tests total; the whole workspace type-checks against one root{" "}
      <code>tsconfig.json</code>. GitHub Actions (<code>.github/workflows/ci.yml</code>) runs <code>pnpm typecheck</code> +{" "}
      <code>pnpm test</code> on every push to <code>main</code> and every PR — packages resolve to source
      (<code>exports</code> → <code>./src</code>), so the suite needs no build step.</p>

      <footer>See the <a href="/golden-cases.html">golden cases</a> for the behavior catalog.</footer>
    </DocsLayout>
  );
}
