import { DocsLayout } from "../layout";
import { Code } from "../code";

export function RuntimePage() {
  return (
    <DocsLayout active="runtime.html">
      <title>@gleanql/client runtime · glean</title>
      <h1><code>@gleanql/client</code> runtime</h1>
      <p className="lede">A Suspense-aware runtime that owns cache identity and read behavior. Transport is delegated to a
      client adapter, so the runtime never overlaps a normalized client cache.</p>

      <div className="note"><strong>Dependencies.</strong> Runtime dep on <code>@gleanql/core</code> only. Because the package
      now ships React hooks (<code>useGlean</code>) + the hydrator components in source (<code>glue-client.ts</code> /{" "}
      <code>glue-server.ts</code>), <code>react</code> is a <strong>peer dependency</strong> (<code>&gt;=18</code>).</div>

      <h2>Client adapter (the only transport seam)</h2>
      <p>The runtime owns the graph — cache, normalization, reactivity; an adapter owns the wire. The interface is two
      methods, so the transport is pluggable: a plain fetch adapter ships in-box (its <code>subscribe</code> streams over
      Server-Sent Events by default), a built-in <code>createGraphWsAdapter</code> carries everything over a{" "}
      <code>graphql-ws</code> WebSocket, and an app already running urql/Apollo can wrap it here. We do <em>not</em> use a
      client's normalized cache (it would duplicate ours) — the adapter is pure transport.</p>
<Code lang="tsx">{`
interface GraphClientAdapter {
  execute<TData, TVariables>(operation, variables, context): Promise<GraphResult<TData>>;
  subscribe?<…>(…): AsyncIterable<GraphResult<TData>>;   // SSE by default; or graphql-ws
}

const adapter = createFetchAdapter({ endpoint, headers?(context), fetch?, subscriptionEndpoint? });

// WebSocket transport — one graphql-ws client drives execute + subscribe.
// @gleanql/client does not bundle graphql-ws; the app installs it and passes the client.
import { createClient } from "graphql-ws";
const wsAdapter = createGraphWsAdapter({ client: createClient({ url: "wss://…/graphql" }), extensions?(context) });
`}</Code>
      <p>Request <em>context</em> (auth token, shop domain, locale, env) is used only to build headers (fetch) or
      per-operation <code>extensions</code> (graphql-ws) — it is never serialized into the request body or to the client.</p>

      <p className="note"><strong>Persisted operations.</strong> <code>createFetchAdapter(&#123; persisted: true &#125;)</code>{" "}
      sends every compiled operation <strong>by its sha-256 hash</strong> (<code>extensions.persistedQuery.sha256Hash</code>{" "}
      — the APQ wire shape), never by document, and retries once with the document if the server answers{" "}
      <code>PersistedQueryNotFound</code>. The server side is one helper: <code>createPersistedResolver(operations)</code>{" "}
      maps an incoming body to an allowlisted document (<code>ok</code> / <code>not-found</code> / <code>rejected</code>;{" "}
      <code>allowUnpersisted</code> opts out of rejection). The build owns both ends, so the allowlist is free — enable it
      with <a href="/vite.html"><code>persisted: true</code> on the plugin</a>.</p>

      <h2>Cache identity model</h2>
      <p>Two storage identities, exactly as the brief specifies:</p>
      <table>
        <tr><th>Identity</th><th>Key</th><th>When</th></tr>
        <tr><td>Normalized entity</td><td><code>__typename + id</code></td><td>type exposes an <code>id</code></td></tr>
        <tr><td>Path identity</td><td><code>root + args + path</code></td><td>object without <code>id</code></td></tr>
        <tr><td>Scalar</td><td>stored inline</td><td>leaf values</td></tr>
      </table>
      <p>Two query paths returning the same <code>__typename + id</code> resolve to <em>one</em> record, so an update
      through any path is visible through all of them.</p>
<Code lang="tsx">{`
cache.recordKey(ref)            // entity identity wins over path
cache.getField(ref, fieldKey)   // → { status: "ready", value } | { status: "missing" }
cache.merge(ref, fields)
cache.invalidate(ref) · cache.invalidateField(ref, key)
cache.recordVersion(key)     // per-record counter, bumped on each write (fine-grained reactivity)
cache.snapshot() · GraphCache.fromSnapshot(snap)
`}</Code>

      <h2>Suspense-aware reads</h2>
      <p>A read is synchronous on a hit. On a miss it enqueues the missing <code>(ref, field)</code>, creates exactly
      one cached promise, and throws it (the Suspense contract). Re-reading a pending field throws the{" "}
      <em>same</em> promise — no duplicate request, stable across React render retries.</p>
<Code lang="tsx">{`
function readField(ref, fieldKey) {
  const got = cache.getField(ref, fieldKey);
  if (got.status === "ready") return got.value;   // sync hit
  const existing = pending.get(key);
  if (existing) throw existing.promise;          // reuse — no new request
  // otherwise: enqueue, schedule a microtask flush, throw a fresh promise
}
`}</Code>

      <h2>Reactivity &amp; cache-first refetch</h2>
      <p>The cache carries a global <code>version</code> + <code>subscribe(listener)</code>, bumped on every write — the{" "}
      <code>useSyncExternalStore</code> contract and the one notify channel. A naive subscriber on that version is{" "}
      <em>coarse</em>: any write re-renders every graph component. So the cache <em>also</em> keeps per-record version
      counters (<code>recordVersion(key)</code>), bumped on each write alongside the global one, and <code>useGlean</code>{" "}
      gates its snapshot on just the records the component read (valtio's model).</p>
      <p><strong>Fine-grained reactivity.</strong> A graph proxy read records which record it touched into its binding's
      read tracker (<code>GraphBinding.tracker</code> in <code>proxy.ts</code>). <code>useGlean</code> binds the graph with
      a fresh per-render set; the reads in that render populate it. Its <code>useSyncExternalStore</code> subscriber recomputes a
      digest of <em>just those records'</em> versions on each notify (<code>affectedDigest</code>) and re-renders only when
      the digest changed — so a global notify skips components whose keys are untouched. A component re-renders only when
      a field it read actually changed.</p>
<Code lang="tsx">{`
function affectedDigest(cache, keys) {     // keys = what this render read (fields, or whole records)
  let out = "";
  for (const key of keys) out += \`\${key}:\${cache.trackedVersion(key)}|\`;
  return out;                            // changes iff a tracked key's version bumped
}
`}</Code>
      <p>Tracking is <strong>field-level</strong>: a read records the exact <code>record + field</code> it touched, so two
      components reading different fields of the <em>same</em> entity (one reads <code>product.title</code>, another{" "}
      <code>product.views</code>) don't wake each other. The cache keeps both per-field versions (for <code>useGlean</code>)
      and per-record versions (<code>usePaginated</code> tracks its connection's whole record, re-rendering when a page
      lands); <code>trackedVersion</code> resolves a tracked key at its own granularity. Attribution is <strong>per
      binding</strong>: <code>useGlean</code> binds the graph with this render's own <code>affected</code> set, so reads
      through its proxies record into it directly — fiber-local, so interleaved concurrent renders can't cross-attribute
      (a module-global tracker stays only as a fallback for the trackerless server / isomorphic accessor). SSR is a no-op.{" "}
      <code>useMutation</code> needs no cache subscription — its state drives
      loading/data, and a displayed entity reacts through <code>useGlean</code>. Beyond the per-key digest,{" "}
      <code>useGlean</code> also re-renders on a <strong>page-pointer change</strong> (hydration or client navigation):
      root resolution changes for every reader then, so an island that first rendered before hydration re-resolves its
      roots and re-tracks the right keys, rather than staying bound to a stale pre-hydration path ref.</p>
      <p><code>runRoute</code> is <em>cache-first</em>: it persists each root call's link
      (<code>product(handle:"x") → Product:123</code>) and, on a re-run, serves from the cache when the full selection is
      already present — skipping the network. <code>refetch()</code> bypasses that to force a fresh fetch; the re-seed bumps
      the version and only the components whose records changed update.</p>

      <h2>Store retention &amp; GC (reference-counted, Relay-style)</h2>
      <p>The same read-tracking that drives fine-grained re-rendering also drives <strong>retention</strong>: post-commit,
      a tracking hook (<code>useGlean</code> / <code>usePaginated</code>) <em>retains</em> the records this render read —
      a reference count on each record — re-diffs the set every render, and releases on unmount. Retained records are
      privileged twice:</p>
      <ul>
        <li><strong>LRU eviction skips them.</strong> With a <code>maxCacheRecords</code> cap, the eviction victim is the
        coldest <em>unretained</em> record — what's on screen is never evicted, even if it's the oldest.</li>
        <li><strong><code>cache.gc()</code> sweeps only the unretained.</strong> Version counters survive collection, so a
        refetched record stays monotonic for its trackers.</li>
      </ul>
      <p>But "unretained" alone is <em>not</em> a reason to drop data — a back-navigation should hit a warm cache. So
      automatic collection is staleness-aware and opt-in: the cache carries a generation clock
      (<code>advanceEpoch()</code>, advanced per navigation; every read/write/retain re-stamps a record), and{" "}
      <code>gc(&#123; keepEpochs: N &#125;)</code> drops only records that are unretained <em>and</em> untouched for N
      generations. The plugin's <a href="/vite.html"><code>gcKeepPages</code></a> option wires this to navigations;
      bare <code>gc()</code> remains the full reset (logout). <code>maxCacheRecords</code> (LRU) bounds capacity;
      this bounds staleness.</p>
<Code lang="tsx">{`
cache.retain(key)      // pin a record; returns the matching release (idempotent)
cache.isRetained(key)
cache.gc()              // drop every unretained record; returns how many

// The hooks do this automatically — manual retain() is only for non-React readers.
`}</Code>

      <h2>Error surfaces</h2>
      <p>One channel per surface: a failed <code>fetchMissing</code> <em>rejects</em> the suspended read's promise (the
      React error-boundary contract — pair every route/island with a boundary); <code>unexpectedMissingField:
      "error"</code> throws synchronously on reads the compiler should have covered. <code>runRoute</code> returns{" "}
      <code>errors</code> beside <code>roots</code> (the preload 404 branch). Mutations never throw on logical failures —{" "}
      <code>MutationResult</code> carries <code>error</code> (transport/GraphQL) and <code>userErrors</code> (your
      schema's), and optimistic writes roll back on either. The fetch adapter turns non-JSON responses into a clear
      transport error; GraphQL <code>errors</code> always ride the result object.</p>
      <p><strong>Central observability:</strong> <code>createGraphClient(&#123; onEvent &#125;)</code> mirrors every
      runtime incident to one channel — <code>refresh-error</code>, <code>mutation-error</code> (transport/GraphQL
      only; <code>userErrors</code> are expected outcomes and not reported), <code>subscription-error</code>,{" "}
      <code>persisted-retry</code> (the server didn't know a hash), and <code>gc</code> (something was collected on
      navigation). Wire it to Sentry &amp; friends; a throwing listener is swallowed — observability must never break
      the app. Cyclic optimistic data fails normalization with a clear <code>circular reference</code> error instead
      of a stack overflow.</p>

      <h2>Missing-field batching</h2>
      <p>Multiple misses in the same tick batch into a single <code>fetchMissing</code> call (one patch operation).
      This is the runtime side of the brief's "runtime missing-field batching".</p>
<Code lang="tsx">{`
new GraphRuntime({
  fetchMissing: (misses) => Promise<MissingFieldResult[]>, // the seam to your transport
  cache?,
  unexpectedMissingField?: "allow" | "warn" | "error", // hybrid / strict
  schedule?, onWarn?,
})
`}</Code>

      <h2>Seeding &amp; result normalization</h2>
      <p>Because every object selection includes <code>__typename</code> (and <code>id</code> when available), a
      GraphQL JSON result carries enough information to normalize itself into the cache — no selection needed:</p>
<Code lang="tsx">{`
runtime.seedResult(data) // returns each root field's ref for reading

// __typename + id → entity record;  otherwise → path record;
// scalars inline; object fields store a ref; lists store arrays of refs/scalars
`}</Code>

      <h2>Runtime graph proxies</h2>
      <p>The compiler infers <em>what</em> to fetch; the proxies make ordinary reads actually <em>execute</em>. A graph
      value is a Proxy over a cache ref. Property access routes through the Suspense-aware runtime — a scalar reads
      through, an object field re-wraps as a child proxy, a list maps to child proxies, a field with arguments
      becomes a callable. Nothing in userland sees a ref, a selection, or a promise.</p>
<Code lang="tsx">{`
const graph = bindGraph({ schema, getRuntime, roots }); // roots from runRoute()
const product = graph.product({ handle });            // proxy over the seeded ref
product.title                         // scalar → cache read (sync hit / throws promise)
product.featuredImage?.url            // object → child proxy; null short-circuits
collection.products({ first: 12 }).nodes  // callable + list → array of proxies
product.selection                     // escape hatch: { ref, type }
`}</Code>
      <p>A lone callable field reads by its plain name; argument-conflicting variants the compiler aliased
      (<code>url_transformMaxWidth300</code>) are resolved by their argument-derived key — the proxy tries the
      most-specific key first, then the plain name, so it is correct without knowing about conflicts.</p>

      <h2>Request scope</h2>
      <p>A module-level <code>import &#123; glean &#125; from "@gleanql/client"</code> must resolve to <em>the runtime for the current
      request</em> on the server (concurrent requests must not share a cache) and a singleton in the browser.{" "}
      <code>GraphScope</code> is that seam — back it with <code>AsyncLocalStorage</code> for automatic per-request
      isolation, or resolve from the framework's own request context.</p>
<Code lang="tsx">{`
scope.run(active, fn)  // server: install the request runtime for this render
scope.current()        // what \`glean\` resolves to (throws outside any scope)
scope.set(active)      // client: install the singleton after hydration
`}</Code>

      <h2>The route flow (framework seam)</h2>
      <p>A compiled operation + a client adapter + a request context is enough to drive a route. A framework adapter
      (RWSDK first) answers "which operation for this entrypoint?" and "how do I build the request context?".</p>
<Code lang="tsx">{`
await runRoute({ operation, routeContext, adapter, context, runtime });
// 1 compute variables  2 execute  3 seed cache  → { variables, roots, errors }
`}</Code>
      <p>The preferred end-to-end flow: adapter identifies the entrypoint → load the generated operation → compute
      variables from params/search/context → fetch → seed the cache → components render and read synchronously →
      missing/lazy fields suspend.</p>

      <h2>Hydration — two models</h2>
      <p>There are two ways the server cache reaches the client, picked by the host.</p>
      <p><strong>SSR <code>&lt;script&gt;</code> (non-RSC hosts).</strong> Server renders against a server-side cache;
      serialize <code>runtime.snapshot()</code> + root handles; the client recreates the cache with{" "}
      <code>GraphRuntime.hydrate(snapshot, options)</code> and can still Suspense-fetch missing fields through its
      adapter. The payload is published once on <code>window</code> and read once — simple and synchronous.</p>
      <p><strong>RSC flight (React Server Components).</strong> Under RSC the <code>Document</code> shell renders once
      but each client navigation re-streams <em>only the page subtree</em>, so a one-shot global goes stale on
      navigation. Instead the snapshot rides the RSC flight stream as a <em>client-component prop</em> (it is plain JSON
      by construction), and on every (re)render that component folds it into a single <strong>long-lived</strong> client
      runtime — the cache <em>accumulates</em> across navigations rather than being rebuilt. The primitives:</p>
<Code lang="tsx">{`
runtime.absorbRecords(snapshot)     // fold a snapshot, write-only (no notify); → changed?
runtime.notify()                    // bump version + run listeners (after absorbRecords)
runtime.absorb(snapshot)            // absorbRecords + notify, in one call

absorbHydrationPayload(runtime, payload)  // render-phase merge (write-only); idempotent
pagePointer(payload)                      // → GraphPagePointer: operation + vars for refresh()
`}</Code>
      <p>Both models are driven by one typed factory, <code>createGraphClient</code> (<code>src/glue-client.ts</code>):
      omit a scope for the RSC private singleton (fed by <code>&lt;GraphHydrator&gt;</code>), or pass the app's shared
      scope for isomorphic SSR (the host calls <code>hydrate(payload)</code>). Its server counterpart,{" "}
      <code>createGraphServer</code> (<code>src/glue-server.ts</code>), produces <code>GraphHydrate</code> /{" "}
      <code>withGraphHydration</code>. The generated <code>@gleanql/client/client</code> and{" "}
      <code>@gleanql/client/server</code> entrypoints are thin shims over these factories (re-exporting{" "}
      <code>useGlean</code> / <code>refresh</code> / <code>hydrate</code> / <code>GraphHydrator</code> and{" "}
      <code>GraphHydrate</code> / <code>withGraphHydration</code>) — the typed logic lives in source, not template
      strings. See <a href="/vite.html">@gleanql/vite</a>.</p>
      <p><code>absorbHydrationPayload</code> is a render-phase merge — write-only, no subscriber notify (the caller bumps
      in a commit-phase effect) — so it is safe to call during render and idempotent across React retries.{" "}
      <code>pagePointer</code> derives the current operation + variables a client island uses to <code>refresh()</code>.
      Because the runtime is long-lived, <code>bindGraph</code>'s <code>roots</code> can be a getter, resolved per call,
      so the bound graph follows the page-current roots across navigations.</p>

      <h2>Client-side <code>refresh()</code></h2>
      <p><code>refresh(operationName?)</code> re-runs the <strong>entire</strong> compiled operation for the current page
      (or the named one) over the wire — bypassing cache-first (<code>refetch</code> in <code>route.ts</code> calls{" "}
      <code>runRoute</code> with <code>cacheFirst: false</code>) — and re-seeds the cache. The network request fetches the{" "}
      <em>whole</em> operation, not a field-level slice. The normalized cache then reconciles by entity identity
      (<code>__typename + id</code>), so only fields that actually changed re-render, but the over-the-wire payload is the
      full operation. To refetch a smaller slice today, pass a smaller operation name. The current page's operation +
      variables come from <code>pagePointer</code>; the re-seed bumps the cache version, so subscribers
      (<code>useGlean</code>) re-render.</p>

      <h2>List-root membership (<code>appendToRoot</code> / <code>removeFromRoot</code>)</h2>
      <p>A <strong>list root</strong> (<code>type Query &#123; todos: [Todo!] &#125;</code>, read as <code>glean.todos()</code>) keeps
      its membership in the page pointer's <code>roots</code> array — <em>not</em> in any normalized record. A field change
      to an element (a toggle) reconciles by identity for free, but <strong>adding or removing an element changes the root
      array</strong>, which a reader only sees by re-resolving roots. So instead of <code>refresh()</code>-ing the whole
      list after every add/remove, splice membership in place:</p>
<Code lang="tsx">{`
appendToRoot("todos", entity, { prepend?, at? }) // add — dedupes; { at } inserts at an index
removeFromRoot("todos", entity)              // remove — entity, { __typename, id }, or a ref
`}</Code>
      <p>Each resolves the entity's ref, rewrites <code>currentPage.roots[field]</code>, and bumps the page epoch so root
      readers re-resolve + re-render. No network round-trip. (For an <em>object</em> root the ref is stable, so these are a
      no-op there — its field-version bump already drives the update.)</p>
      <p><strong>Optimistic UI.</strong> Pass a client-built entity with its fields and <code>appendToRoot</code> also{" "}
      <em>seeds</em> them (id included) into the cache, so the row renders <em>before</em> the server responds. Generate the
      id client-side so the optimistic row is the final row — the mutation carries the same id and normalizes over it, with
      nothing to reconcile. Rather than wiring this by hand, declare it on the mutation with{" "}
      <code>optimisticRoots</code>: the hook applies the splice before the request and rolls it back automatically on
      failure (re-inserting a removed row at its index, evicting a failed add's record) — the membership counterpart to{" "}
      <code>optimistic</code>'s field writes:</p>
<Code lang="tsx">{`
const [add] = useMutation(selector, {
  optimisticRoots: (roots, vars) =>
    roots.append("todos", { __typename: "Todo", id: vars.id, title: vars.title, completed: false }, { prepend: true }),
});
// the handler is just: await add({ id: crypto.randomUUID(), title })  — splice + rollback handled
`}</Code>
      <p>No list-mutation convention is baked into the compiler (no <code>@appendNode</code>-style directive); membership is
      a plain runtime primitive — call <code>appendToRoot</code>/<code>removeFromRoot</code> directly where you know the
      intent (e.g. a post-confirmation splice), or declare <code>optimisticRoots</code> to fold it into the mutation's
      optimistic/rollback lifecycle.</p>

      <h2>Mutations &amp; invalidation</h2>
      <p>The write side. A mutation runs through the same adapter as a query; its result is normalized into the cache,
      so any entity it returns (<code>__typename + id</code>) updates <em>in place</em> and every read of that entity
      reflects the change for free. On top of that: <code>userErrors</code>, optimistic writes with automatic
      rollback, and invalidation.</p>
<Code lang="tsx">{`
const result = await runMutation({
  operation, variables, adapter, context, runtime,
  optimistic: (tx) => tx.set(productRef, "title", "Renamed"), // rolled back on failure
  invalidate: (data) => [collectionRef],                  // refetch on next read
});
result.ok;          // false on transport errors OR userErrors
result.userErrors;  // [{ field, message, code }]
`}</Code>
      <p>It never rejects for logical failures — inspect <code>ok</code>/<code>userErrors</code>/<code>errors</code>.{" "}
      <code>createMutator</code> binds one callable per compiled mutation operation as the <code>glean.mutate.*</code>{" "}
      namespace; <code>invalidate</code> / <code>invalidateField</code> drop records (and clear pending reads) so the
      next read re-fetches.</p>

      <h2>Client hooks (islands)</h2>
      <p>The generated <code>@gleanql/client/client</code> entrypoint exposes two compile-time hooks for{" "}
      <code>"use client"</code> islands — both thin shims over <code>createGraphClient</code>{" "}
      (<code>src/glue-client.ts</code>). Each takes a <em>selector</em> or a live graph <em>value</em> that runs only at
      compile time: the compiler reads it to build the operation, the build injects the precompiled operation name into the
      call, and the runtime executes that op. No schema convention is baked into core — the reads define the operation, the
      same philosophy as <code>usePaginated</code>/<code>refresh</code>.</p>

      <p><strong><code>useMutation</code> (gqty-style).</strong> The selector roots at the schema's <code>Mutation</code>{" "}
      type. The compiler walks it into a <code>kind:"mutation"</code> operation: the first <code>m.field(args)</code> call
      is the mutation root (its args lift to operation variables), and the chain after it (<code>.cart.totalQuantity</code>,{" "}
      <code>.title</code>) is the result selection. The selector never runs at runtime — it types <code>data</code> while
      the runtime runs the injected <code>opName</code>. Returns <code>[mutate, state]</code>; <code>mutate(vars)</code>{" "}
      runs the same engine as the server <code>runMutation</code> (optimistic writes with rollback, <code>userErrors</code>,
      invalidate — all passed through the options), folds the result into the normalized cache (returned entities carry{" "}
      <code>__typename + id</code>, so they update in place), and never rejects for logical failures (inspect{" "}
      <code>ok</code>/<code>userErrors</code>/<code>errors</code> on the returned <code>MutationResult</code>). The hook
      needs no cache subscription: its <code>state</code> drives loading/data, and a displayed entity reacts through{" "}
      <code>useGlean</code>.</p>
<Code lang="tsx">{`
const [rename, { isLoading, data, error, userErrors }] = useMutation(
  (m, vars) => m.setProductTitle(vars).title,        // selector: compile-time only, never runs
  { onCompleted, onError, optimistic, update, invalidate }, // options, all optional
);
await rename({ id, title });   // mutate(vars) → Promise<MutationResult>; resolves even on failure
`}</Code>

      <p><strong><code>usePaginated</code>.</strong> Paginate a connection you already read in render — pass the value
      (<code>glean.collection(&#123; handle &#125;).products(&#123; first &#125;)</code>), and <code>fetchMore(args)</code> re-runs that
      connection's selection with your <code>args</code> (whatever cursor/offset convention your schema uses) and merges the
      page in. No pagination convention is assumed and nothing is auto-selected: you read <code>pageInfo</code>/cursors
      yourself, so the compiler includes exactly what you use. Default <code>merge</code> concatenates <code>nodes</code>;
      pass <code>merge</code> for de-dupe/sort (its helpers — <code>existing</code>, <code>incoming</code>,{" "}
      <code>uniqBy</code>, <code>sortBy</code> — work on node <em>values</em>, i.e. graph proxies). The hook tracks the
      connection's own record, so it re-renders when the fetched page lands.</p>
<Code lang="tsx">{`
const { fetchMore, isLoading, error } = usePaginated(connection, { merge });
await fetchMore({ after: endCursor });   // re-runs the selection with your args, merges the page
`}</Code>

      <p><strong><code>useSubscription</code> (gqty-style).</strong> Same compile path as <code>useMutation</code>, rooted at
      the schema's <code>Subscription</code> type — the selector defines a <code>kind:"subscription"</code> operation and
      the build injects its name. On mount the hook opens the adapter's <code>subscribe</code> stream (SSE by default),
      folds each pushed payload into the normalized cache via <code>seedResult</code> — so any reader re-renders
      fine-grained — and surfaces the latest as <code>data</code> alongside <code>error</code>. Pass variables via{" "}
      <code>options.variables</code> (the stream re-opens when they change, and closes on unmount). Client-only: a no-op
      during SSR. The idiomatic display path is to read the live entity through <code>useGlean</code>, as below.</p>
<Code lang="tsx">{`
const { data, error } = useSubscription(
  (s, vars) => s.productChanged(vars).priceRange.minVariantPrice.amount,  // compile-time selector
  { variables: { handle }, onData, onError },
);
const price = useGlean()?.product({ handle })?.priceRange.minVariantPrice.amount;  // live, in place
`}</Code>

      <footer>Next: <a href="/rwsdk.html">RedwoodSDK integration</a> (RSC) or{" "}
      <a href="/react-router.html">React Router integration</a> (isomorphic) — the two framework integrations.</footer>
    </DocsLayout>
  );
}
