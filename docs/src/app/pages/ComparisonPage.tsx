import { DocsLayout } from "../layout";

export function ComparisonPage() {
  return (
    <DocsLayout active="comparison.html">
      <title>vs Relay &amp; gqty · glean</title>
      <h1>Glean vs Relay vs gqty</h1>
      <p className="lede">The three tools answer the same question — <em>how does a React component get exactly the
      GraphQL data it reads?</em> — from three different directions. Glean's position: gqty's developer
      experience with Relay's runtime characteristics.</p>

      <h2>The axis that actually matters</h2>
      <p><strong>Relay</strong> asks you to write the data requirement <em>twice</em>: once as the JSX that reads
      fields, and once as a colocated fragment that declares them. The compiler then gives you optimal static
      operations, persisted queries, and a normalized store. Maximum runtime efficiency, paid for in ceremony.</p>
      <p><strong>gqty</strong> deletes the second copy: field access <em>is</em> the data requirement, captured by a
      runtime proxy. Maximum DX, paid for at runtime — the query is discovered <em>while rendering</em>, so first
      renders suspend against a proxy, requests can waterfall, and there is no static document to persist,
      allowlist, or analyze.</p>
      <p><strong>Glean</strong> takes gqty's contract — plain components, field access is the requirement, zero
      GraphQL in app code — and moves the discovery to <em>build time</em>. The compiler statically analyzes
      routes, components, prop flow, and islands, and emits the same kind of artifact Relay's compiler does: a
      merged, deduplicated, hashed, persisted-able operation per route.</p>

      <div className="note"><strong>One sentence:</strong> if Relay is "declare twice, optimal at runtime" and gqty is
      "declare once, resolved at runtime", Glean is "declare once, resolved at build time".</div>

      <h2>Feature matrix</h2>
      <table>
        <thead>
          <tr><th></th><th>Glean</th><th>Relay</th><th>gqty</th></tr>
        </thead>
        <tbody>
          <tr><td>GraphQL in app code</td><td>none — inferred from field reads</td><td>fragments + queries (GraphQL tagged templates)</td><td>none — inferred from field reads</td></tr>
          <tr><td>When the operation is known</td><td><strong>build time</strong> (static document)</td><td><strong>build time</strong> (static document)</td><td>runtime (proxy capture, per render)</td></tr>
          <tr><td>Request waterfalls</td><td>no — one operation per route</td><td>no — one query per surface</td><td>possible — discovery happens while rendering</td></tr>
          <tr><td>Normalized cache</td><td>yes (entity + path identity)</td><td>yes (data-ID based)</td><td>yes</td></tr>
          <tr><td>Re-render granularity</td><td><strong>field-level</strong> (per-record + per-field versions)</td><td>fragment-level</td><td>field-level (proxy tracking)</td></tr>
          <tr><td>Optimistic updates</td><td>declarative, incl. list membership (<code>optimisticRoots</code>) with auto-rollback</td><td>imperative updaters / declarative directives</td><td>manual cache writes</td></tr>
          <tr><td>Subscriptions</td><td>compile-time selectors over SSE or graphql-ws</td><td>yes</td><td>yes</td></tr>
          <tr><td>Persisted operations</td><td>yes — sha-256 manifest emitted per build, APQ-shaped wire format, server allowlist helper</td><td>yes — first-class</td><td>no (documents don't exist statically)</td></tr>
          <tr><td>SSR / RSC</td><td>request-scoped runtime + hydration payload; RedwoodSDK (RSC) and React Router presets</td><td>framework integrations (Next, etc.)</td><td>SSR helpers; proxy model complicates RSC</td></tr>
          <tr><td>Partial-render attribution</td><td>per-component read-map → <code>refresh()</code> targets one component's fields</td><td>fragment = the unit of refetch</td><td>—</td></tr>
          <tr><td>Unanalyzable patterns</td><td>build-time diagnostic (never silently under-fetches)</td><td>impossible by construction (fragments are explicit)</td><td>n/a — everything resolves at runtime</td></tr>
          <tr><td>@defer / @stream</td><td>not yet — <code>&lt;GraphLazy&gt;</code> covers the use-case (see <a href="/decisions.html">decisions</a>)</td><td>yes</td><td>no</td></tr>
          <tr><td>Store GC / retention</td><td>reference-counted retention (mounted readers pin their records) + LRU cap + <code>gc()</code></td><td>reference-counted retention</td><td>cache policies</td></tr>
          <tr><td>Maturity</td><td>alpha</td><td>battle-tested at Meta scale</td><td>community project</td></tr>
        </tbody>
      </table>

      <h2>What "compiled prop flow" replaces fragments with</h2>
      <p>Relay's fragments exist so a child component can own its data requirement and any parent can compose it.
      Glean gets the same composition by <em>following the props</em>: the compiler resolves imported components,
      binds graph-valued props into their bodies, and folds their reads into the route operation — through{" "}
      <code>.map</code> callbacks (inline, destructured, or a named function reference), intermediate bindings,
      helper functions, conditional component choice, registries, and islands that open their own roots. The
      per-component <strong>read-map</strong> keeps the attribution fragments would have given you: each
      component's field paths are recorded, so <code>refresh()</code> can refetch exactly one component's data.</p>

      <div className="warn"><strong>Honest limit:</strong> a fragment is a <em>guarantee</em>; static analysis is a{" "}
      <em>best effort with a tripwire</em>. Code the analyzer can't follow (a dynamically selected callback, a
      component picked from a non-registry map) doesn't silently under-fetch — it fails the build with a
      diagnostic (<code>unsupported-list-flow</code>, <code>unresolved-dynamic-component</code>, …) and asks for an
      analyzable form. Relay never needs the tripwire; gqty never needs the analysis.</div>

      <h2>When to choose what</h2>
      <p><strong>Choose Relay</strong> when you're operating at a scale where its guarantees pay for the ceremony:
      hundreds of engineers, strict fragment ownership, @defer/@stream, store retention semantics, and a decade of
      production hardening.</p>
      <p><strong>Choose gqty</strong> when you want zero-GraphQL DX and your app is client-heavy with tolerance for
      runtime query discovery — or you need patterns static analysis fundamentally can't follow.</p>
      <p><strong>Choose Glean</strong> when you want plain TypeScript components <em>and</em> static operations:
      server-rendered React (RSC or SSR) where the route's data should be one compiled, hashed, allowlisted
      request — with fine-grained reactivity, optimistic writes, and live subscriptions on top, none of it visible
      in app code.</p>

      <h2>Receipts</h2>
      <p>Every claim above is executable in this repo: the <a href="/golden-cases.html">golden cases</a> lock the
      compiler's coverage (36 fixtures through two type-checker engines), the runtime behaviors are unit-tested
      (380+ tests), and <code>examples/rwsdk-real</code>, <code>examples/rwsdk-todo</code> and{" "}
      <code>examples/remix-real</code> are bootable apps exercising RSC islands, optimistic TodoMVC membership,
      and isomorphic SSR respectively.</p>
    </DocsLayout>
  );
}
