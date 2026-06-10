import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  GraphRuntime,
  GraphScope,
  bindGraph,
  createFetchAdapter,
  refetch,
  runMutation,
  absorbHydrationPayload,
  pagePointer,
  selectionOf,
  type BoundGraph,
  type FieldValue,
  type GraphRef,
  type CompiledOperation,
  type GraphClientAdapter,
  type GraphHydrationPayload,
  type GraphPagePointer,
  type GraphRequestContext,
  type ActiveGraph,
  type MutationResult,
  type RunMutationOptions,
  type UserError,
  errorMessage,
} from "./index.js";
import type { SchemaModel } from "@gleanql/core";
import { maskViolations, useTracked } from "./reactivity.js";
import {
  paginateConnection,
  buildComponentOperation,
  type UsePaginatedOptions,
  type UsePaginatedResult,
} from "./paginate.js";

// The reactivity substrate and the pagination query-building live in their own
// modules; re-export the public pieces so the generated glue + tests keep one entry.
export { affectedDigest } from "./reactivity.js";
export { buildPageOperation, type MergeHelpers } from "./paginate.js";
export { paginateConnection, buildComponentOperation };
export type { UsePaginatedOptions, UsePaginatedResult };

/** The latest render's value behind a stable ref — so a stable callback always sees fresh options. */
function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

/**
 * The client-side runtime glue, shared by both hydration models. The generated
 * `@gleanql/client/client` entrypoint is a thin shim that calls this with its baked
 * config and re-exports the pieces a host needs — so the real (typed, testable)
 * logic lives here, not in template strings.
 *
 * - RSC (RedwoodSDK): omit `scope`. A private {@link GraphScope} singleton is used;
 *   the auto-injected `<GraphHydrator>` folds each page's snapshot in as it rides
 *   the flight stream.
 * - Isomorphic SSR (React Router): pass the app's shared `scope`. The host calls
 *   `hydrate(payload)` from `entry.client`/root with loader data; the same scope
 *   backs the isomorphic `graph` accessor and `useGlean()`.
 */
export interface GraphClientOptions {
  readonly schema: SchemaModel;
  readonly operations: Record<string, CompiledOperation>;
  readonly endpoint: string;
  /** Shared scope (isomorphic hosts). Omit for an RSC-private singleton. */
  readonly scope?: GraphScope;
  /** Optional LRU cap on the long-lived client cache (it accumulates across navigations). */
  readonly maxCacheRecords?: number;
  /** Send operations by sha-256 hash (persisted-operation mode) instead of by document. */
  readonly persisted?: boolean;
  /**
   * Staleness-aware GC (opt-in): on each navigation, collect records that are
   * unretained AND untouched for this many page generations. Unset = no automatic
   * collection ("unretained" alone is not a reason to drop valid data — the LRU
   * cap bounds capacity; this bounds staleness). `gcKeepPages: 2` keeps roughly
   * the last two pages' data warm for back-navigation.
   */
  readonly gcKeepPages?: number;
  /**
   * Central runtime-incident channel — the one place to wire an error tracker
   * (Sentry, etc.). Every failure ALREADY surfaces locally (hook state, rejected
   * promises, error boundaries); this mirrors them so production issues are
   * observable without instrumenting each call site. A throwing listener is
   * swallowed — observability must never break the app.
   */
  readonly onEvent?: (event: GraphClientEvent) => void;
  /**
   * Dev read-masking (opt-in via the plugin's `masking` option): per-component
   * sets of `Type.field` pairs the compiler proved each component reads. A
   * component touching data OUTSIDE its set renders fields another component
   * fetched — warned once per pair, never thrown.
   */
  readonly readMask?: Record<string, readonly string[]>;
}

/** A reportable runtime incident (see {@link GraphClientOptions.onEvent}). */
export type GraphClientEvent =
  | { readonly type: "refresh-error"; readonly operation: string; readonly error: unknown }
  | { readonly type: "operation-error"; readonly operation: string; readonly error: unknown }
  | { readonly type: "mutation-error"; readonly operation: string; readonly error: string }
  | { readonly type: "subscription-error"; readonly operation: string; readonly error: string }
  /** The server didn't know a persisted hash; the document was re-sent once (APQ register). */
  | { readonly type: "persisted-retry"; readonly operation: string }
  /** Staleness-aware GC ran on navigation (only reported when something was collected). */
  | { readonly type: "gc"; readonly dropped: number };

export interface GraphClient {
  /**
   * The active graph, re-rendering the caller when the cache changes.
   * `component` is build-injected when read-masking is on — never hand-written.
   */
  useGlean(component?: string): BoundGraph | undefined;
  /**
   * Refetch over the wire; the cache notifies the UI.
   *  - `refresh()` — the whole current-page operation.
   *  - `refresh("OpName")` — a named operation, whole.
   *  - `refresh({ component })` — only what that component reads (its compiled
   *    read-map), pruned to a slice. The build injects `{ component }` into bare
   *    `refresh()` calls, so an island just writes `refresh()` to refetch its own
   *    fields — no hand-written selection.
   */
  refresh(target?: string | { component: string }): Promise<void>;
  /**
   * Paginate a connection you already read in render. `connection` is the value
   * (`glean.collection({handle}).products({first})`); `fetchMore(args)` re-runs that
   * connection's selection with your `args` (whatever cursor/offset convention your
   * schema uses) and merges the page in — by default concatenating `nodes`, or via
   * the `merge` you supply. No schema convention is assumed and nothing is
   * auto-selected: you read `pageInfo`/cursors yourself, so the compiler includes
   * exactly what you use.
   */
  usePaginated(connection: unknown, options?: UsePaginatedOptions): UsePaginatedResult;
  /**
   * The write side (gqty-style). `selector` is compile-time only — it drives the
   * mutation operation and types `data`; the build injects the operation name as
   * `opName` so the runtime runs the compiled `operations[opName]`. Returns
   * `[mutate, state]`: `await mutate(vars)` runs the mutation, folds the result into
   * the normalized cache (entities update in place), and surfaces
   * `isLoading`/`data`/`error`/`userErrors`. `optimistic`/`update`/`invalidate` are
   * passed through to the engine; `onCompleted`/`onError` fire after.
   */
  useMutation<TData, TVars>(
    selector: unknown,
    options?: UseMutationOptions<TData, TVars>,
    opName?: string,
  ): UseMutationResult<TData, TVars>;
  /**
   * Subscribe to a live operation (gqty-style). `selector` is compile-time only — it
   * drives the `kind:"subscription"` operation and types `data`; the build injects the
   * operation name. Each pushed payload normalizes into the cache (so any reader
   * re-renders fine-grained), and the latest is returned as `data` alongside `error`.
   * Pass operation variables via `options.variables`; the stream re-opens when they
   * change and closes on unmount. Client-only (a no-op during SSR).
   */
  useSubscription<TData, TVars>(
    selector: unknown,
    options?: UseSubscriptionOptions<TData, TVars>,
    opName?: string,
  ): SubscriptionState<TData>;
  /**
   * Splice an entity into a LIST root's membership without a refetch. A list root's
   * membership lives in the page pointer's `roots`, not in any normalized record — so
   * after a mutation that adds an element you'd otherwise `refresh()` the whole list.
   * Instead, `appendToRoot("todos", result.addTodo)` adds the entity's ref to the root
   * array and re-renders its readers. Pass `{ prepend: true }` to add at the front;
   * idempotent (an already-present entity isn't duplicated).
   *
   * For OPTIMISTIC UI, pass a client-built entity with its fields
   * (`{ __typename: "Todo", id, title, completed: false }`) — those fields are seeded
   * into the cache so the row renders immediately, before the server responds. Generate
   * the `id` client-side and pass it to the mutation; roll back with `removeFromRoot` if
   * the mutation fails. `{ at: index }` inserts at a position (clamped) rather than the
   * end/front — e.g. to restore a row to its original spot when an optimistic remove fails.
   */
  appendToRoot(rootField: string, entity: unknown, options?: { prepend?: boolean; at?: number }): void;
  /** Remove an entity from a list root's membership without a refetch (the inverse of
   * {@link appendToRoot}); pass the removed entity, a `{ __typename, id }`, or its ref. */
  removeFromRoot(rootField: string, entity: unknown): void;
  /**
   * Execute a NAMED operation (compiled or registered) with explicit variables,
   * outside any page flow — the runtime surface for `buildQuery`-registered
   * operations (dashboards, reports). The result seeds the normalized cache
   * (entities update in place for every reader) and is returned raw. In persisted
   * mode the request rides the operation's sha-256 hash like any other.
   */
  runOperation(
    name: string,
    variables?: Record<string, unknown>,
  ): Promise<{ data?: unknown; errors?: ReadonlyArray<{ message: string }> }>;
  /**
   * Subscribe to runtime incidents at RUNTIME (the generated glue bakes config as
   * data, so a function can't ride the plugin options — register from app code
   * instead). Returns the unsubscribe. See {@link GraphClientEvent}.
   */
  onEvent(listener: (event: GraphClientEvent) => void): () => void;
  /** Fold a hydration payload into the client runtime (host-driven; isomorphic SSR). */
  hydrate(payload: GraphHydrationPayload | undefined): void;
  /** Client island that folds its payload prop in as it crosses the RSC boundary. */
  GraphHydrator(props: { payload: GraphHydrationPayload | undefined }): null;
}

/**
 * Splice a ref into (or out of) a list root's membership — pure, so it's unit-testable
 * apart from the page-pointer plumbing. `keyOf` identifies refs (the cache's record key)
 * so an append dedupes and a remove matches. Returns a NEW roots map (callers swap it in
 * via the page pointer to trigger a re-render).
 */
export function spliceRootList(
  roots: Record<string, FieldValue>,
  field: string,
  ref: GraphRef,
  keyOf: (value: FieldValue) => string | undefined,
  mode: { remove?: boolean; prepend?: boolean; at?: number },
): Record<string, FieldValue> {
  const key = keyOf(ref);
  const current = Array.isArray(roots[field]) ? (roots[field] as FieldValue[]) : [];
  const without = key == null ? current : current.filter((r) => keyOf(r) !== key);
  let next: FieldValue[];
  if (mode.remove) next = without;
  else if (mode.at != null) next = [...without.slice(0, mode.at), ref, ...without.slice(mode.at)]; // insert at index (clamped)
  else if (mode.prepend) next = [ref, ...without];
  else next = [...without, ref];
  return { ...roots, [field]: next };
}

/** Resolve a `GraphRef` from a graph proxy/selection, a raw `{__typename,id}`/`{path}`, or a ref. */
export function refOf(entity: unknown): GraphRef | undefined {
  if (entity == null || typeof entity !== "object") return undefined;
  const sel = selectionOf(entity);
  if (sel) return sel.ref;
  const o = entity as Record<string, unknown>;
  if (typeof o.__typename === "string" && o.id != null) return { __typename: o.__typename, id: String(o.id) };
  if (typeof o.path === "string") return { path: o.path };
  return undefined;
}

/**
 * The data fields (beyond identity) of a raw entity object, for OPTIMISTIC seeding —
 * so `appendToRoot` can render a client-built entity before the server confirms it.
 * Returns undefined for a graph proxy (already cached) or a bare `{__typename,id}` ref
 * (nothing to render).
 */
export function seedableFields(entity: unknown): Record<string, FieldValue> | undefined {
  if (entity == null || typeof entity !== "object" || selectionOf(entity)) return undefined;
  const o = entity as Record<string, unknown>;
  if (typeof o.__typename !== "string" || o.id == null) return undefined;
  // Seed every non-__typename field, INCLUDING id — a proxy reads `.id` as a normal cache
  // field (not off the ref), so the row needs it present (e.g. for its React key). Only
  // worth seeding when there's data beyond the identity, though: a bare {__typename,id}
  // ref (a membership-only op) seeds nothing.
  const fields: Record<string, FieldValue> = {};
  let hasData = false;
  for (const [k, v] of Object.entries(o)) {
    if (k === "__typename") continue;
    fields[k] = v as FieldValue;
    if (k !== "id") hasData = true;
  }
  return hasData ? fields : undefined;
}

/** Optimistic list-root membership ops handed to a `useMutation` `optimisticRoots` callback. */
export interface RootMembership {
  /** Splice an entity into a list root now; undone (and the optimistic record evicted) on failure. */
  append(field: string, entity: unknown, options?: { prepend?: boolean; at?: number }): void;
  /** Splice an entity out now; re-inserted at its original index on failure. */
  remove(field: string, entity: unknown): void;
}

/**
 * Build a membership transaction over a set of splice ops — pure, so the
 * apply/record/rollback logic is unit-testable apart from the page-pointer plumbing.
 * `append` records an undo that removes (and evicts the optimistic record); `remove`
 * captures the entity's index first and re-inserts there. `rollback` replays the undos
 * in reverse. The hook wires `ops` to the real `appendToRoot`/`removeFromRoot`.
 */
export function createMembershipTx(ops: {
  append: (field: string, entity: unknown, options?: { prepend?: boolean; at?: number }) => void;
  remove: (field: string, entity: unknown) => void;
  indexOf: (field: string, entity: unknown) => number | undefined;
  evictOptimistic?: (entity: unknown) => void;
}): { membership: RootMembership; rollback: () => void } {
  const undos: Array<() => void> = [];
  const membership: RootMembership = {
    append(field, entity, options) {
      ops.append(field, entity, options);
      undos.push(() => {
        ops.remove(field, entity);
        ops.evictOptimistic?.(entity);
      });
    },
    remove(field, entity) {
      const at = ops.indexOf(field, entity);
      ops.remove(field, entity);
      undos.push(() => ops.append(field, entity, at != null ? { at } : undefined));
    },
  };
  return {
    membership,
    rollback: () => {
      for (let i = undos.length - 1; i >= 0; i--) undos[i]!();
    },
  };
}

export interface UseMutationOptions<TData = unknown, TVars = Record<string, unknown>> {
  /** Called after a successful mutation with the normalized result data. */
  readonly onCompleted?: (data: TData | undefined) => void;
  /** Called after a failed mutation (transport error or `userErrors`). */
  readonly onError?: (result: MutationResult<TData>) => void;
  /** Optimistically patch the cache before the request; rolled back on failure. */
  readonly optimistic?: RunMutationOptions<TData>["optimistic"];
  /**
   * Optimistically splice a LIST root before the request — applied immediately (the row
   * appears/disappears now) and rolled back automatically if the mutation fails. The
   * membership counterpart to `optimistic`'s field writes: `optimistic` rolls back cache
   * fields, this rolls back `roots` membership (re-inserting a removed row at its index,
   * evicting a failed-add's record). Generate ids client-side so the optimistic entity is
   * the final one — the mutation normalizes over it with nothing to reconcile.
   */
  readonly optimisticRoots?: (membership: RootMembership, vars: TVars) => void;
  /** Apply the server result after normalization (e.g. prepend to a connection). */
  readonly update?: RunMutationOptions<TData>["update"];
  /** Graph values / refs to invalidate on success (refetch on next read). */
  readonly invalidate?: RunMutationOptions<TData>["invalidate"];
}

export interface MutationState<TData = unknown> {
  /** True while the mutation is in flight. */
  readonly isLoading: boolean;
  /** The normalized result data from the last successful mutation. */
  readonly data?: TData;
  /** The last transport/execution error message, if any. */
  readonly error?: string;
  /** Logical, per-mutation `userErrors` from the last run. */
  readonly userErrors: readonly UserError[];
}

/** `[mutate, state]` — call `mutate(vars)`, read loading/data/error off `state`. */
export type UseMutationResult<TData = unknown, TVars = Record<string, unknown>> = readonly [
  (vars: TVars) => Promise<MutationResult<TData>>,
  MutationState<TData>,
];

export interface UseSubscriptionOptions<TData = unknown, TVars = Record<string, unknown>> {
  /** Operation variables (the selector's `vars`). The subscription re-opens when they change. */
  readonly variables?: TVars;
  /** Called with each pushed payload (after it normalizes into the cache). */
  readonly onData?: (data: TData) => void;
  /** Called when the stream surfaces a transport/execution error. */
  readonly onError?: (message: string) => void;
}

export interface SubscriptionState<TData = unknown> {
  /** The latest pushed payload (also folded into the normalized cache). */
  readonly data?: TData;
  /** The last transport/execution error from the stream, if any. */
  readonly error?: string;
}

export function createGraphClient(opts: GraphClientOptions): GraphClient {
  const scope = opts.scope ?? new GraphScope();
  let adapter: GraphClientAdapter | undefined;
  let currentPage: GraphPagePointer | undefined;

  // Incident listeners: the baked `opts.onEvent` plus anything registered at
  // runtime via `onEvent(listener)` — the generated glue can't bake a function,
  // so apps subscribe from app code instead.
  const eventListeners = new Set<(event: GraphClientEvent) => void>();
  if (opts.onEvent) eventListeners.add(opts.onEvent);

  /** Report a runtime incident; a throwing listener must never break the app. */
  const report = (event: GraphClientEvent): void => {
    for (const listener of eventListeners) {
      try {
        listener(event);
      } catch {
        /* observability is best-effort */
      }
    }
  };

  function onEvent(listener: (event: GraphClientEvent) => void): () => void {
    eventListeners.add(listener);
    return () => eventListeners.delete(listener);
  }

  // The page pointer changes on hydration and on every client navigation. That
  // changes root resolution for EVERY reader (`glean.x()` resolves through the new
  // page's `roots`), so a bump here re-renders all `useGlean` components — letting an
  // island that first rendered before hydration re-resolve its roots and re-track the
  // right keys, instead of staying bound to a stale pre-hydration path ref.
  let pageEpoch = 0;
  const pageListeners = new Set<() => void>();
  const setCurrentPage = (page: GraphPagePointer | undefined): void => {
    currentPage = page;
    pageEpoch++;
    for (const listener of pageListeners) listener();
    // Staleness-aware GC (opt-in): a navigation advances the cache's generation
    // clock and collects only records that are BOTH unretained and untouched for
    // `gcKeepPages` generations — recently-left pages stay warm for back-nav.
    if (opts.gcKeepPages != null) {
      const cache = active()?.runtime.cache;
      if (cache) {
        // Collect BEFORE advancing the clock: the page just absorbed is stamped
        // with the current epoch — judging it one generation later would collect
        // a freshly-hydrated page at `gcKeepPages: 1`.
        const dropped = cache.gc({ keepEpochs: opts.gcKeepPages });
        cache.advanceEpoch();
        if (dropped > 0) report({ type: "gc", dropped });
      }
    }
  };
  const subscribePage = (cb: () => void): (() => void) => {
    pageListeners.add(cb);
    return () => pageListeners.delete(cb);
  };

  const adapterFor = () =>
    (adapter ??= createFetchAdapter({
      endpoint: opts.endpoint,
      persisted: opts.persisted,
      onPersistedRetry: (operation) => report({ type: "persisted-retry", operation }),
    }));
  const active = () => {
    try {
      return scope.current();
    } catch {
      return undefined;
    }
  };

  /**
   * Resolve the client runtime, creating an empty one (installed on the scope) on
   * first use so `useGlean()` always has something to subscribe to. No-op on the
   * server: there the runtime is the request's (set by the host), never built here.
   */
  function ensure() {
    if (typeof window === "undefined") return active();
    const existing = active();
    if (existing) return existing;
    const runtime = new GraphRuntime({
      keyOf: (typename, obj) => opts.schema.identityOf(typename, obj),
      fetchMissing: async (misses) => misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: undefined })),
      maxCacheRecords: opts.maxCacheRecords,
    });
    const graph = bindGraph({ schema: opts.schema, getRuntime: () => runtime, roots: () => currentPage?.roots });
    scope.set({ runtime, graph });
    return active();
  }

  /** Fold a payload into the runtime (idempotent, write-only) and set the page pointer. */
  function absorb(a: { runtime: GraphRuntime }, payload: GraphHydrationPayload, notify: boolean) {
    const changed = absorbHydrationPayload(a.runtime, payload);
    setCurrentPage(pagePointer(payload));
    if (notify && changed) a.runtime.notify();
  }

  function hydrate(payload: GraphHydrationPayload | undefined) {
    if (typeof window === "undefined" || !payload) return;
    const a = ensure();
    if (a) absorb(a, payload, true);
  }

  function GraphHydrator({ payload }: { payload: GraphHydrationPayload | undefined }): null {
    const last = useRef<GraphHydrationPayload | null>(null);
    const a = ensure();
    // Render-phase: fold the snapshot in so sibling islands read warm this pass
    // (write-only — the notify is deferred to the effect).
    if (a && payload && payload !== last.current) absorbHydrationPayload(a.runtime, payload);
    useEffect(() => {
      if (a && payload && payload !== last.current) {
        last.current = payload;
        setCurrentPage(pagePointer(payload));
        a.runtime.notify();
      }
    });
    return null;
  }

  // Masking: warned pairs are remembered per component+pair (one warning, not a
  // console flood), and allowed-sets are materialized per component on demand.
  const maskWarned = new Set<string>();
  const maskSets = new Map<string, ReadonlySet<string>>();
  const maskAllowedFor = (component: string): ReadonlySet<string> | undefined => {
    const pairs = opts.readMask?.[component];
    if (!pairs) return undefined;
    let set = maskSets.get(component);
    if (!set) maskSets.set(component, (set = new Set(pairs)));
    return set;
  };

  function useGlean(component?: string): BoundGraph | undefined {
    const a = ensure();
    // Re-render on a page-pointer change (hydration / navigation) so roots re-resolve.
    // The epoch ALSO gates readiness: on the server there is no client runtime, so an
    // island renders its pre-data fallback. `useSyncExternalStore` returns the server
    // snapshot (0) during the hydration render too, so the first client render matches
    // the server (still no binding) — no hydration mismatch — then re-renders with the
    // live binding once the page pointer lands (epoch > 0).
    const epoch = useSyncExternalStore(subscribePage, () => pageEpoch, () => 0);
    // Fine-grained: a fresh read tracker for THIS render. Reads in the component body
    // record which records they touched, and the hook re-renders only when one of those
    // changes — not on every write.
    let tracker: Set<string> | undefined;
    useTracked(
      a?.runtime,
      (affected) => {
        tracker = affected;
      },
      // Read-masking (dev, opt-in): post-commit, flag field reads outside this
      // component's COMPILED read-map — it's rendering data another component
      // fetched, which goes stale/missing when that component's reads change.
      component && opts.readMask
        ? (tracked) => {
            const allowed = maskAllowedFor(component);
            const cache = a?.runtime.cache;
            if (!allowed || !cache) return;
            for (const pair of maskViolations(cache, allowed, tracked)) {
              const once = `${component}|${pair}`;
              if (maskWarned.has(once)) continue;
              maskWarned.add(once);
              console.warn(
                `[glean] <${component}> read ${pair} outside its compiled read-map. ` +
                  `It renders data another component fetched — read the field in <${component}> itself (or lift the read) so the compiler includes it.`,
              );
            }
          }
        : undefined,
    );
    if (!a || epoch === 0) return undefined;
    // Bind the graph with this render's tracker so every read attributes to it directly
    // — fiber-local, not an ambient global, so interleaved concurrent renders can't
    // cross-attribute. (The isomorphic accessor / server `a.graph` carry no tracker.)
    return bindGraph({
      schema: opts.schema,
      getRuntime: () => a.runtime,
      roots: () => currentPage?.roots,
      tracker,
    });
  }

  async function refresh(target?: string | { component: string }): Promise<void> {
    const a = active();
    if (!a || !currentPage) return;
    const operationName = typeof target === "string" ? target : currentPage.operationName;
    try {
      await doRefresh(a, target);
    } catch (error) {
      report({ type: "refresh-error", operation: operationName, error });
      throw error; // callers still observe the failure where they awaited it
    }
  }

  async function doRefresh(a: ActiveGraph, target?: string | { component: string }): Promise<void> {
    if (!currentPage) return;

    // Re-seeding bumps the cache records a refetch touched (entity field changes
    // propagate through fine-grained tracking). But a LIST root's membership lives in
    // `roots`, not in any tracked cache record — adding/removing an element changes the
    // root array, which a reader only sees by re-resolving roots. So fold the fresh
    // roots into the page pointer and bump the page epoch, re-resolving + re-rendering
    // every root reader. (For object roots this is a harmless no-op: the ref is stable
    // and the field-version bump already drove the re-render.)
    const refreshRoots = (roots: Record<string, FieldValue>): void => {
      if (!currentPage) return;
      setCurrentPage({ ...currentPage, roots: { ...currentPage.roots, ...roots } });
    };

    // Component-auto: refetch only what the calling component reads (a slice).
    if (target && typeof target === "object") {
      const op = opts.operations[currentPage.operationName];
      const built = op && buildComponentOperation(op, target.component);
      if (built) {
        const result = await adapterFor().execute(built, currentPage.variables, currentPage.context as GraphRequestContext);
        if (result?.data) refreshRoots(a.runtime.seedResult(result.data as Record<string, unknown>));
        return;
      }
      // Component not in this op's read-map → fall through to a whole-op refresh.
    }

    const operation = opts.operations[typeof target === "string" ? target : currentPage.operationName];
    if (!operation) return;
    const result = await refetch({
      operation,
      routeContext: { params: currentPage.variables },
      adapter: adapterFor(),
      context: currentPage.context as GraphRequestContext,
      runtime: a.runtime,
    });
    refreshRoots(result.roots);
  }

  async function runOperation(
    name: string,
    variables: Record<string, unknown> = {},
  ): Promise<{ data?: unknown; errors?: ReadonlyArray<{ message: string }> }> {
    const op = opts.operations[name];
    if (!op) {
      throw new Error(`runOperation: unknown operation "${name}" — it must be compiled from a route or registered via the plugin's \`operations\` module.`);
    }
    const a = ensure();
    try {
      const result = await adapterFor().execute(
        { name: op.name, kind: op.kind, document: op.document, hash: op.hash },
        variables,
        (currentPage?.context as GraphRequestContext | undefined) ?? {},
      );
      const failure = result.errors?.[0]?.message;
      if (failure) report({ type: "operation-error", operation: name, error: failure });
      // Seed even partial data: entity updates propagate to every reader fine-grained.
      if (result.data && a) a.runtime.seedResult(result.data as Record<string, unknown>);
      return result;
    } catch (error) {
      report({ type: "operation-error", operation: name, error });
      throw error;
    }
  }

  // A list-root membership array can hold non-ref values; resolving a record key
  // tolerates that (a non-ref returns undefined and is left untouched). Shared by the
  // splice (dedupe) and index-of (rollback) paths.
  const recordKeyOf = (a: { runtime: GraphRuntime }, value: FieldValue): string | undefined => {
    try {
      return a.runtime.cache.recordKey(value as GraphRef);
    } catch {
      return undefined;
    }
  };

  /** Splice a list root's membership in place (no refetch) and re-render its readers. */
  function spliceRoot(rootField: string, entity: unknown, mode: { remove?: boolean; prepend?: boolean; at?: number }): void {
    const a = active();
    if (!a || !currentPage) return;
    const ref = refOf(entity);
    if (!ref) return;
    const keyOf = (value: FieldValue) => recordKeyOf(a, value);
    setCurrentPage({ ...currentPage, roots: spliceRootList(currentPage.roots, rootField, ref, keyOf, mode) });
  }

  function appendToRoot(rootField: string, entity: unknown, options?: { prepend?: boolean; at?: number }): void {
    // Optimistic: when handed a client-built entity (not a cached proxy/mutation result),
    // seed its fields so the new row renders immediately, before any server round-trip.
    const a = active();
    const fields = seedableFields(entity);
    if (a && fields) a.runtime.seed(refOf(entity)!, fields);
    spliceRoot(rootField, entity, { prepend: options?.prepend, at: options?.at });
  }
  function removeFromRoot(rootField: string, entity: unknown): void {
    spliceRoot(rootField, entity, { remove: true });
  }

  /** The entity's current index in a list root (for restoring its place on a rollback). */
  function rootIndexOf(a: { runtime: GraphRuntime }, rootField: string, entity: unknown): number | undefined {
    const ref = refOf(entity);
    const list = currentPage?.roots[rootField];
    if (!ref || !Array.isArray(list)) return undefined;
    const key = recordKeyOf(a, ref);
    const i = list.findIndex((r) => recordKeyOf(a, r) === key);
    return i >= 0 ? i : undefined;
  }

  function usePaginated(connection: unknown, options?: UsePaginatedOptions): UsePaginatedResult {
    const a = ensure();
    // Fine-grained: re-render when the paginated connection's own record changes
    // (a fetched page lands via `appendConnection`), not on every cache write.
    useTracked(a?.runtime, (affected) => {
      const sel = selectionOf(connection);
      if (a && sel) {
        try {
          affected.add(a.runtime.cache.recordKey(sel.ref));
        } catch {
          /* connection without identity/path — leave untracked */
        }
      }
    });
    const [isLoading, setLoading] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);

    // The connection value is fresh each render; the stable `fetchMore` reads it here.
    const latest = useLatest(connection);
    const merge = options?.merge;

    const fetchMore = useCallback(
      async (args: Record<string, unknown>): Promise<boolean> => {
        const act = active();
        if (!act || !currentPage) return false;
        setLoading(true);
        setError(undefined);
        try {
          const res = await paginateConnection({
            connection: latest.current,
            args,
            merge,
            schema: opts.schema,
            operations: opts.operations,
            adapter: adapterFor(),
            runtime: act.runtime,
            page: currentPage,
          });
          if (res.error) setError(res.error);
          return res.ok;
        } finally {
          setLoading(false);
        }
      },
      [merge],
    );

    return { fetchMore, isLoading, error };
  }

  function useMutation<TData, TVars>(
    _selector: unknown,
    options?: UseMutationOptions<TData, TVars>,
    opName?: string,
  ): UseMutationResult<TData, TVars> {
    ensure();
    // No cache subscription here: `setState` drives the hook's own loading/data/error,
    // and any component displaying a mutated entity reads it through `useGlean`, which
    // re-renders fine-grained when that entity's record changes.
    const [state, setState] = useState<MutationState<TData>>({ isLoading: false, userErrors: [] });

    // Options are fresh each render; the stable `mutate` reads them here.
    const latestOptions = useLatest(options);

    const mutate = useCallback(
      async (vars: TVars): Promise<MutationResult<TData>> => {
        const act = active();
        if (!act || !opName) {
          const message = opName ? "no active graph runtime" : "useMutation: missing operation binding";
          const result = mutationFailure<TData>(message);
          setState({ isLoading: false, userErrors: [], error: message });
          latestOptions.current?.onError?.(result);
          return result;
        }
        setState((s) => ({ ...s, isLoading: true, error: undefined }));
        // Optimistic membership: splice list roots NOW (the row appears/disappears before
        // the request) and record how to undo it; rolled back below if the mutation fails.
        const tx = latestOptions.current?.optimisticRoots
          ? createMembershipTx({
              append: appendToRoot,
              remove: removeFromRoot,
              indexOf: (field, entity) => rootIndexOf(act, field, entity),
              evictOptimistic: (entity) => {
                const ref = refOf(entity);
                if (ref && seedableFields(entity)) act.runtime.invalidate(ref);
              },
            })
          : undefined;
        if (tx) latestOptions.current!.optimisticRoots!(tx.membership, vars);
        const result = await runBoundMutation<TData, TVars>({
          opName,
          vars,
          options: latestOptions.current,
          operations: opts.operations,
          adapter: adapterFor(),
          runtime: act.runtime,
          context: (currentPage?.context as GraphRequestContext | undefined) ?? {},
        });
        if (!result.ok) tx?.rollback();
        // Transport/GraphQL failures are incidents; `userErrors` are expected
        // domain outcomes and are NOT reported.
        const failure = result.errors?.[0]?.message;
        if (failure) report({ type: "mutation-error", operation: opName, error: failure });
        setState({ isLoading: false, data: result.data, error: failure, userErrors: result.userErrors });
        if (result.ok) latestOptions.current?.onCompleted?.(result.data);
        else latestOptions.current?.onError?.(result);
        return result;
      },
      [opName],
    );

    return [mutate, state];
  }

  function useSubscription<TData, TVars>(
    _selector: unknown,
    options?: UseSubscriptionOptions<TData, TVars>,
    opName?: string,
  ): SubscriptionState<TData> {
    ensure();
    const [state, setState] = useState<SubscriptionState<TData>>({});
    // Options are fresh each render; the stream's callbacks read them here.
    const latest = useLatest(options);
    // Re-open the stream only when the operation or its variables change.
    const varsKey = JSON.stringify(options?.variables ?? null);

    useEffect(() => {
      const act = active();
      if (!act || !opName || typeof window === "undefined") return;
      return runBoundSubscription<TData, TVars>({
        opName,
        vars: (latest.current?.variables ?? {}) as TVars,
        operations: opts.operations,
        adapter: adapterFor(),
        runtime: act.runtime,
        context: (currentPage?.context as GraphRequestContext | undefined) ?? {},
        onData: (data) => {
          setState({ data, error: undefined });
          latest.current?.onData?.(data);
        },
        onError: (message) => {
          report({ type: "subscription-error", operation: opName, error: message });
          setState((s) => ({ ...s, error: message }));
          latest.current?.onError?.(message);
        },
      });
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opName, varsKey]);

    return state;
  }

  return { useGlean, refresh, runOperation, onEvent, appendToRoot, removeFromRoot, usePaginated, useMutation, useSubscription, hydrate, GraphHydrator };
}

/** A failed `MutationResult` carrying a single transport-level message. */
function mutationFailure<TData>(message: string): MutationResult<TData> {
  return { userErrors: [], errors: [{ message }], ok: false };
}

/** Resolve a compiled op by name + kind and map its variables, or return an error message. */
function resolveBoundOp(
  operations: Record<string, CompiledOperation>,
  opName: string,
  kind: "mutation" | "subscription",
  vars: unknown,
): { op: CompiledOperation; variables: Record<string, unknown> } | { error: string } {
  const op = operations[opName];
  if (!op || op.kind !== kind) return { error: `unknown ${kind} operation: ${opName}` };
  return { op, variables: (op.variables(vars) ?? {}) as Record<string, unknown> };
}

/** Params for {@link runBoundSubscription}. */
export interface RunBoundSubscriptionParams<TData, TVars> {
  /** The compiled subscription operation's name (injected at build time). */
  readonly opName: string;
  /** The selector's `vars` — mapped to GraphQL variables by the op's factory. */
  readonly vars: TVars;
  readonly operations: Record<string, CompiledOperation>;
  readonly adapter: GraphClientAdapter;
  readonly runtime: GraphRuntime;
  readonly context: GraphRequestContext;
  readonly onData?: (data: TData) => void;
  readonly onError?: (message: string) => void;
}

/**
 * The non-hook core of `useSubscription`: resolve the compiled subscription, open the
 * adapter's stream, and fold each pushed result into the cache (so readers re-render
 * fine-grained). Returns an unsubscribe function. Exported so it can be tested without
 * a React renderer — the hook is a thin wrapper that adds state + lifecycle.
 */
export function runBoundSubscription<TData = unknown, TVars = Record<string, unknown>>(
  params: RunBoundSubscriptionParams<TData, TVars>,
): () => void {
  const { opName, vars, operations, adapter, runtime, context, onData, onError } = params;
  const resolved = resolveBoundOp(operations, opName, "subscription", vars);
  if ("error" in resolved) {
    onError?.(resolved.error);
    return () => {};
  }
  if (!adapter.subscribe) {
    onError?.("adapter does not support subscriptions");
    return () => {};
  }
  const { op, variables } = resolved;
  const iterator = adapter
    .subscribe({ name: op.name, kind: "subscription", document: op.document }, variables, context)
    [Symbol.asyncIterator]();

  let active = true;
  void (async () => {
    try {
      while (active) {
        const { value, done } = await iterator.next();
        if (done || !active) break;
        if (value?.errors?.length) {
          onError?.(value.errors[0]!.message);
          continue;
        }
        if (value?.data) {
          runtime.seedResult(value.data as Record<string, unknown>);
          onData?.(value.data as TData);
        }
      }
    } catch (err) {
      if (active) onError?.(errorMessage(err));
    }
  })();

  return () => {
    active = false;
    void iterator.return?.();
  };
}

/** Params for {@link runBoundMutation}. */
export interface RunBoundMutationParams<TData, TVars> {
  /** The compiled mutation operation's name (injected at build time). */
  readonly opName: string;
  /** The `mutate(vars)` argument — mapped to GraphQL variables by the op's factory. */
  readonly vars: TVars;
  readonly options?: UseMutationOptions<TData, TVars>;
  readonly operations: Record<string, CompiledOperation>;
  readonly adapter: GraphClientAdapter;
  readonly runtime: GraphRuntime;
  readonly context: GraphRequestContext;
}

/**
 * The non-hook core of `useMutation`: resolve the compiled mutation by name, map
 * the caller's `vars` to GraphQL variables via the op's factory, and run it through
 * the engine (normalize + optimistic + invalidate). Exported so it can be tested
 * without a React renderer — the hook is a thin wrapper adding loading state and a
 * cache subscription.
 */
export async function runBoundMutation<TData = unknown, TVars = Record<string, unknown>>(
  params: RunBoundMutationParams<TData, TVars>,
): Promise<MutationResult<TData>> {
  const { opName, vars, options, operations, adapter, runtime, context } = params;
  const resolved = resolveBoundOp(operations, opName, "mutation", vars);
  if ("error" in resolved) return mutationFailure<TData>(resolved.error);
  const { op, variables } = resolved;
  return runMutation<TData>({
    operation: { name: op.name, kind: "mutation", document: op.document },
    variables,
    adapter,
    context,
    runtime,
    ...(options?.optimistic ? { optimistic: options.optimistic } : {}),
    ...(options?.update ? { update: options.update } : {}),
    ...(options?.invalidate ? { invalidate: options.invalidate } : {}),
  });
}
