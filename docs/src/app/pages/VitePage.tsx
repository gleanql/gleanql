import { DocsLayout } from "../layout";

export function VitePage() {
  return (
    <DocsLayout active="vite.html">
      <title>@gleanql/vite · glean</title>
      <h1><code>@gleanql/vite</code></h1>
      <p className="lede">The build plugin — the only build wiring an app needs. It generates the schema-specific runtime
      (the <code>glean</code> accessor, branded types, compiled operations) into the <code>@gleanql/client</code> package
      the app installs, so app code imports everything from <code>@gleanql/client</code>.</p>

      <h2>Usage</h2>
      <p>One line in <code>vite.config.mts</code> — just the schema. Routes are
      discovered automatically (any file that opens a <code>graph</code> root), so there's
      nothing to keep in sync as pages come and go:</p>
{/* prettier-ignore */}
<pre><code><span className="k">{"import"}</span>{" { defineConfig } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"vite\""}</span>{";\n"}<span className="k">{"import"}</span>{" { "}<span className="f">{"glean"}</span>{" } "}<span className="k">{"from"}</span>{" "}<span className="s">{"\"@gleanql/vite\""}</span>{";\n\n"}<span className="k">{"export default"}</span>{" "}<span className="f">{"defineConfig"}</span>{"({\n  plugins: [\n    "}<span className="f">{"glean"}</span>{"({ schema: "}<span className="s">{"\"schema.graphql\""}</span>{" }),\n    "}<span className="f">{"redwood"}</span>{"(),\n  ],\n});"}</code></pre>
      <p>A route is any module that calls a <code>graph</code> root — <code>glean.product(...)</code> —
      the same signal the analyzer uses to mint an operation. Pass an explicit{" "}
      <code>routes: [...]</code> array to override discovery (e.g. an aliased <code>glean</code>{" "}
      import, or to narrow the set).</p>

      <h2>What it does on startup</h2>
      <p>The plugin's <code>config()</code> hook runs before RedwoodSDK's directive scan and:</p>
      <ol>
        <li>provisions the <code>@gleanql/client</code> runtime into <code>node_modules</code> as real, in-root JS
          (the scanner requires modules inside the app root), with real <code>.d.ts</code> emitted from source — full
          runtime types, plus client-safe <code>./runtime</code> and <code>./operations</code> entrypoints;</li>
        <li>runs <code>@gleanql/codegen</code> from the schema → <code>SchemaModel</code> + branded types;</li>
        <li>discovers the route files (those that open a <code>graph</code> root, under the preset's{" "}
          <code>appDir</code>) and compiles them with <code>@gleanql/compiler</code> → operations. It builds{" "}
          <strong>one</strong> <code>ts.Program</code> over all files and analyzes each route against it
          (<code>analyzeFile</code> + a shared backend), instead of recreating a full program per route — turning
          O(routes × files) program builds into one. The type engine is selectable via{" "}
          <code>backend</code> (in-process <code>typescript</code> by default; experimental Go-native <code>tsgo</code>);</li>
        <li>writes the generated <code>glean</code> accessor, types, and <code>operations</code> into{" "}
          <code>@gleanql/client/generated</code>, plus a barrel and <code>package.json</code> <code>exports</code>.</li>
      </ol>
      <p>So <code>import &#123; glean &#125; from "@gleanql/client"</code> resolves by ordinary node resolution — no tsconfig
      paths, no alias.</p>

      <h2>Plugin options</h2>
      <p><code>glean(&#123; … &#125;)</code> takes the schema plus a few optional knobs (<code>GraphPluginOptions</code>,{" "}
      <code>src/types.ts</code>):</p>
      <table>
        <tr><th>Option</th><th>Default</th><th>What it does</th></tr>
        <tr><td><code>schema</code></td><td>—</td><td>path to the <code>.graphql</code> SDL, relative to the app root (required).</td></tr>
        <tr><td><code>routes?</code></td><td>auto-discover</td><td>explicit route file list (relative to the app root) to override discovery.</td></tr>
        <tr><td><code>endpoint?</code></td><td><code>"/graphql"</code></td><td>URL the generated client POSTs to for client-side refetch.</td></tr>
        <tr><td><code>framework?</code></td><td><code>"rwsdk"</code></td><td>framework binding — a built-in name or a custom <code>FrameworkPreset</code>.</td></tr>
        <tr><td><code>backend?</code></td><td><code>"typescript"</code></td><td>type engine used to compile routes (see below).</td></tr>
        <tr><td><code>maxCacheRecords?</code></td><td>unbounded</td><td>LRU cap on the long-lived client cache. Opt-in (only enable with a real <code>fetchMissing</code> — an evicted record re-read otherwise resolves to <code>undefined</code>).</td></tr>
        <tr><td><code>strict?</code></td><td><code>false</code></td><td>fail the build on any compiler diagnostic (unsupported pattern). Off ⇒ diagnostics are logged as warnings.</td></tr>
        <tr><td><code>persisted?</code></td><td><code>false</code></td><td>persisted-operation mode: the generated client sends operations <strong>by sha-256 hash</strong> (<code>extensions.persistedQuery.sha256Hash</code>, the APQ wire shape), never by document. Pair the server with <code>createPersistedResolver(operations)</code> (same deploy) or sync the emitted <code>generated/persisted.json</code> manifest to it. Live in <code>examples/rwsdk-real</code>.</td></tr>
        <tr><td><code>gcKeepPages?</code></td><td>off</td><td>staleness-aware GC: on each navigation, collect cache records that are <em>unretained AND untouched for N page generations</em>. Unset = no automatic collection — unretained alone is not a reason to drop valid data (back-nav should hit a warm cache); <code>maxCacheRecords</code> bounds capacity, this bounds staleness.</td></tr>
        <tr><td><code>masking?</code></td><td><code>false</code></td><td>dev READ-MASKING: warn when a component reads a <code>Type.field</code> outside its own compiled read-map — it renders data another component fetched, which goes stale/missing when that component changes (Relay's masking discipline as a dev warning, warned once per pair). Enable in dev only, e.g. <code>masking: process.env.NODE_ENV !== "production"</code>.</td></tr>
        <tr><td><code>operations?</code></td><td>—</td><td>REGISTERED operations: a module whose exports are hand-built <code>buildQuery(...)</code> IR — the escape hatch for shapes the compiler can't extract. The build runs it, prints + hashes each export, and ships them like compiled operations (same generated map, persisted allowlist, devtools). Execute with <code>runOperation(name, variables)</code>.</td></tr>
      </table>

      <h2>Devtools (<code>/__glean</code>) &amp; live recompilation</h2>
      <p>In dev, the plugin serves <code>/__glean</code>: every compiled operation — document, persisted hash, size
      stats with large-operation warnings, and the per-component <strong>read-map tree</strong> — plus any compiler
      diagnostics from the last generate. Because everything is compile-time static, the overlay is the complete,
      exact picture of what the app can put on the wire.</p>
      <p>Editing is live: the plugin watches your route files, the schema, and the registered-operations module —
      adding a field read <strong>recompiles the operation immediately</strong> (no server restart), invalidates the
      module graphs, and reloads the page with the new data shape.</p>

      <p className="note">In persisted mode every build also emits <code>generated/persisted.json</code> — a sorted
      <code>&#123; "&lt;sha256&gt;": "&lt;document&gt;" &#125;</code> manifest, the sync artifact for a
      separately-deployed GraphQL server's allowlist. (The manifest is emitted in every build, in fact — persisted
      mode just makes the client <em>use</em> the hashes.)</p>

      <h2>Type-check backend (<code>typescript</code> / <code>tsgo</code>)</h2>
      <p>Route analysis routes every type/symbol question through the <a href="/architecture.html">backend seam</a>, so
      the engine is swappable behind one option:</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"// default — the in-process TypeScript compiler"}</span>{"\n"}<span className="f">{"glean"}</span>{"({ schema })\n\n"}<span className="c">{"// experimental Go-native engine"}</span>{"\n"}<span className="f">{"glean"}</span>{"({ schema, backend: "}<span className="s">{"\"tsgo\""}</span>{" })"}</code></pre>
      <ul>
        <li><strong><code>"typescript"</code> (default).</strong> The in-process compiler — a real <code>ts.Program</code>{" "}
          + <code>TypeChecker</code>, built once over all files (the{" "}
          <a href="/architecture.html">single shared program</a>).</li>
        <li><strong><code>"tsgo"</code> (experimental).</strong> The Go-native engine
          (<code>@typescript/native-preview</code>, <code>createTsgoBackend</code> in{" "}
          <code>packages/compiler/src/tsgo</code>) — much faster type-checking on large route sets, but <em>pre-release</em>.
          The dependency is optional and dynamically imported; if it can't be resolved (e.g. the platform binary doesn't
          resolve from a bundled plugin under some pnpm layouts) the plugin emits a <code>console.warn</code> and{" "}
          <strong>falls back to <code>"typescript"</code></strong>, so a build never breaks. Selection + fallback live in{" "}
          <code>src/generate.ts</code>.</li>
      </ul>

      <h2>Framework presets</h2>
      <p>Everything framework-specific lives behind a <strong><code>FrameworkPreset</code></strong>{" "}
      (<code>src/types.ts</code> + <code>src/presets/</code>). The core pipeline (<code>generate.ts</code>/<code>index.ts</code>)
      is neutral and delegates; adding a framework is a new preset, not a new branch.</p>
{/* prettier-ignore */}
<pre><code><span className="c">{"// default — RedwoodSDK (RSC)"}</span>{"\n"}<span className="f">{"glean"}</span>{"({ schema })\n\n"}<span className="c">{"// React Router 7 (isomorphic SSR — not RSC)"}</span>{"\n"}<span className="f">{"glean"}</span>{"({ schema, framework: "}<span className="s">{"\"react-router\""}</span>{" })\n\n"}<span className="c">{"// or a custom preset object"}</span>{"\n"}<span className="f">{"glean"}</span>{"({ schema, framework: myPreset })"}</code></pre>
      <p>A preset owns every framework-specific decision:</p>
      <table>
        <tr><th>Preset field</th><th>What it owns</th></tr>
        <tr><td><code>appDir</code></td><td>source dir scanned for route files (rwsdk <code>"src"</code>, RR7 <code>"app"</code>).</td></tr>
        <tr><td><code>requestScope</code></td><td>how the generated <code>glean</code> accessor resolves <em>this request's</em> runtime.</td></tr>
        <tr><td><code>emitClientGlue</code></td><td>the <code>@gleanql/client/client</code> module (<code>useGlean</code>/<code>refresh</code> + hydration).</td></tr>
        <tr><td><code>emitServerGlue?</code></td><td>optional <code>@gleanql/client/server</code> glue (an RSC server component). Omit ⇒ none.</td></tr>
        <tr><td><code>transformRoute?</code></td><td>optional route-module transform (RSC auto-inject). Omit ⇒ no transform runs.</td></tr>
        <tr><td><code>extraExports?</code></td><td>subpath exports beyond <code>.</code>, <code>./schema</code>, <code>./runtime</code>, <code>./operations</code>, <code>./client</code>.</td></tr>
      </table>
      <p>The two built-ins:</p>
      <ul>
        <li><strong>RedwoodSDK (<code>"rwsdk"</code>, default).</strong> RSC. <code>requestScope</code> reads{" "}
          <code>requestInfo.ctx</code>; a <code>transformRoute</code> auto-injects a <code>&lt;GraphHydrate /&gt;</code>{" "}
          server component around route components; emits a <code>./server</code> entry plus a <code>"use client"</code>{" "}
          client glue.</li>
        <li><strong>React Router 7 (<code>"react-router"</code>).</strong> Isomorphic, non-RSC. Emits client glue that is{" "}
          <em>not</em> <code>"use client"</code> and shares the app's scope (no private singleton) — no server glue, no
          route transform. The accessor points at the app's universal scope module
          (<code>requestScope: &#123; import: "activeGraph", from &#125;</code>).</li>
      </ul>
      <p>The <code>requestScope</code> is the only seam <code>@gleanql/client</code> itself cares about — it is otherwise
      framework agnostic. For the custom form, <code>@gleanql/client</code> ships a <code>GraphScope</code> the accessor
      resolves from; a server-only module attaches an <code>AsyncLocalStorage</code> via{" "}
      <code>GraphScope.attachAls(als)</code> to isolate concurrent requests, while the client uses the same scope as a
      singleton.</p>

      <h2>Generated glue: thin shims over typed factories</h2>
      <p>The runtime glue is <strong>not</strong> authored as template strings. The real, typed, unit-tested logic lives
      in <code>@gleanql/client</code> source — <code>createGraphClient</code> (<code>src/glue-client.ts</code>) and{" "}
      <code>createGraphServer</code> (<code>src/glue-server.ts</code>). A preset's <code>emitClientGlue</code> /{" "}
      <code>emitServerGlue</code> emit ~6-line config shims that call those factories with the baked schema +
      operations + endpoint and re-export the public surface:</p>
      <ul>
        <li><strong><code>@gleanql/client/client</code></strong> calls <code>createGraphClient</code> and re-exports{" "}
          <code>useGlean</code> / <code>refresh</code> / <code>hydrate</code> / <code>GraphHydrator</code>.</li>
        <li><strong><code>@gleanql/client/server</code></strong> calls <code>createGraphServer</code> and re-exports{" "}
          <code>GraphHydrate</code> / <code>withGraphHydration</code>.</li>
      </ul>
      <p>The unified <code>createGraphClient</code> serves <em>both</em> hydration models: under RSC it omits a shared
      scope (a private singleton, fed by the auto-injected <code>&lt;GraphHydrator&gt;</code>), and for isomorphic SSR it
      takes the app's shared scope (the host calls <code>hydrate(payload)</code> with loader data). The public API — the
      named exports above — is unchanged; only the authoring moved from strings into source.</p>

      <h2>Build</h2>
      <p>The package is authored in TypeScript (<code>src/&#123;index,generate,emit,render,provision,types&#125;.ts</code>) and
      bundled with <strong>tsdown</strong> (the build tools <code>@gleanql/codegen</code>/<code>compiler</code>/<code>core</code>{" "}
      are bundled in; <code>esbuild</code>/<code>graphql</code>/<code>typescript</code> stay external). The pure
      generators (<code>render</code>, <code>emit</code>) are unit-tested, and the glue logic the shims call
      (<code>createGraphClient</code>/<code>createGraphServer</code> in <code>@gleanql/client</code>) is tested at the
      source, not as emitted strings.</p>

      <footer>Framework integrations: <a href="/rwsdk.html">RedwoodSDK</a> (RSC) ·{" "}
      <a href="/react-router.html">React Router</a> (isomorphic). The runtime side: <code>@gleanql/client</code>.</footer>
    </DocsLayout>
  );
}
