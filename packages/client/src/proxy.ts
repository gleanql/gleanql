import { argAliasSuffix, canonicalArgs, type ArgMap, type ArgValue, type SchemaModel } from "@gleanql/core";
import type { GraphRef, FieldValue } from "./cache.js";
import type { GraphRuntime } from "./runtime.js";

/**
 * Runtime graph proxies.
 *
 * The compiler statically infers what fields a route needs; this layer is what
 * makes ordinary reads (`product.title`, `product.featuredImage?.url`,
 * `collection.products({ first: 12 }).nodes`) actually *execute* at runtime.
 *
 * A graph value is a Proxy over a cache `GraphRef`. Property access routes
 * through the Suspense-aware runtime:
 *  - scalar field  -> `runtime.readField(ref, key)` (sync hit, or throws a promise)
 *  - object field  -> the stored `GraphRef`, re-wrapped as a child proxy
 *  - list field    -> an array of child proxies/scalars
 *  - callable field -> a function `(args) => value` (field arguments)
 *
 * The proxy is intentionally transparent: parent components pass it as a normal
 * prop, child components read fields off it, and nothing in userland sees a ref,
 * a selection object, or a promise (the promise is thrown to Suspense).
 */

/** Escape-hatch / brand keys exposed on every graph proxy. */
export const GRAPH_REF = Symbol.for("graph.ref");
export const GRAPH_TYPE = Symbol.for("graph.type");
export const GRAPH_TRAIL = Symbol.for("graph.trail");

/**
 * Read tracking for fine-grained reactivity. Every field read records the record
 * key it touched into the active tracker; the tracking hook's `useSyncExternalStore`
 * snapshot is then a digest of just those records' versions.
 *
 * Attribution is primarily PER BINDING: `useGlean` binds the graph with its render's
 * own `affected` set (see `GraphBinding.tracker`), so reads through that render's
 * proxies record into that set directly — fiber-local, safe under concurrent/
 * interleaved rendering. This ambient global is only a fallback for proxies created
 * without a binding tracker (the server / isomorphic accessor), where no re-render
 * depends on attribution.
 */
let currentTracker: Set<string> | null = null;

/** Install (or clear) the active read tracker. Returns the previous one. */
export function setReadTracker(tracker: Set<string> | null): Set<string> | null {
  const prev = currentTracker;
  currentTracker = tracker;
  return prev;
}

/** One object-field hop from a Query root: the field name + the args it was called with. */
export interface PathStep {
  readonly name: string;
  readonly args?: Record<string, unknown>;
}

/** The hidden selection token (brief: `product.selection`). */
export interface GraphSelection {
  readonly ref: GraphRef;
  readonly type: string;
}

/** A value is a `GraphRef` if it carries entity identity or a path. */
export function isGraphRef(value: unknown): value is GraphRef {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return (v.__typename != null && v.id != null) || typeof v.path === "string";
}

function toArgValue(value: unknown): ArgValue {
  if (value === null) return { kind: "literal", value: null };
  if (Array.isArray(value)) return { kind: "list", items: value.map(toArgValue) };
  if (typeof value === "object") {
    return { kind: "object", fields: Object.entries(value as object).map(([k, v]) => [k, toArgValue(v)] as const) };
  }
  return { kind: "literal", value: value as string | number | boolean };
}

/** Plain runtime args (`{ first: 12 }`) -> IR `ArgMap`, reusing core's canonicalization. */
export function toArgMap(args: Record<string, unknown> | undefined): ArgMap {
  if (!args) return [];
  return Object.entries(args).map(([k, v]) => [k, toArgValue(v)] as const);
}

/**
 * Candidate response keys for a (possibly callable) field, most-specific first.
 * A callable field that coexisted with a differently-argued sibling was aliased
 * by the merger (`url_transformMaxWidth300`); a lone callable field keeps its
 * plain name. The proxy tries the alias key first, then the plain name, which
 * is correct for both shapes without the proxy having to know about conflicts.
 */
export function responseKeyCandidates(name: string, argMap: ArgMap): readonly string[] {
  if (argMap.length === 0) return [name];
  const suffix = argAliasSuffix(argMap);
  return suffix ? [`${name}_${suffix}`, name] : [name];
}

export interface GraphBinding {
  readonly schema: SchemaModel;
  /** Resolve the active runtime lazily (per request on the server). */
  readonly getRuntime: () => GraphRuntime;
  /**
   * Per-binding read tracker. When a `useGlean` render binds the graph with its own
   * `affected` set, every proxy created from this binding records reads into THAT set
   * — not the ambient global — so concurrent/interleaved renders can't misattribute.
   * Absent (server / isomorphic accessor) → reads fall back to the ambient tracker.
   */
  readonly tracker?: Set<string>;
}

interface ProxyState {
  readonly binding: GraphBinding;
  readonly ref: GraphRef;
  readonly type: string;
  /** Object-field path from a Query root to this value (drives `usePaginated`/`fetchMore`). */
  readonly trail: readonly PathStep[];
}

/** Read a field on a ref, resolving the right response key, and wrap object/list results. */
function readField(state: ProxyState, fieldName: string, args?: Record<string, unknown>): unknown {
  const { binding, ref, type } = state;
  const runtime = binding.getRuntime();
  const fieldDef = binding.schema.getField(type, fieldName);
  const argMap = toArgMap(args);
  const candidates = responseKeyCandidates(fieldName, argMap);

  // Prefer an already-cached candidate key; otherwise read the most specific one
  // (which suspends + enqueues a missing-field fetch under that stable key).
  let key = candidates[0]!;
  for (const candidate of candidates) {
    if (runtime.cache.getField(ref, candidate).status === "ready") {
      key = candidate;
      break;
    }
  }

  // Record this exact field as read (field-level granularity), so the rendering
  // component re-renders only when a field IT read changes — not on any write to the
  // record. Tracked before the read so a currently-missing field still re-renders
  // when it lands. Guard: refs always carry identity or a path here. Prefer the
  // binding's own set (fiber-scoped, set by useGlean) over the ambient global.
  const tracker = binding.tracker ?? currentTracker;
  if (tracker) {
    try {
      tracker.add(runtime.cache.fieldTrackingKey(runtime.cache.recordKey(ref), key));
    } catch {
      /* ref without identity/path — not trackable */
    }
  }

  const raw = runtime.readField(ref, key);
  const childTrail = [...state.trail, { name: fieldName, ...(args ? { args } : {}) }];
  return wrap(binding, raw, fieldDef?.type, childTrail);
}

/** Wrap a raw cache value as a child proxy (object), array of proxies (list), or scalar. */
function wrap(binding: GraphBinding, value: FieldValue, declaredType: string | undefined, trail: readonly PathStep[]): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => wrap(binding, item, declaredType, trail));
  }
  if (isGraphRef(value)) {
    // For union/interface fields the concrete type comes from the ref's __typename.
    const type = (value.__typename as string | undefined) ?? declaredType ?? "Unknown";
    return createGraphProxy(binding, value, type, trail);
  }
  return value;
}

const handler: ProxyHandler<{ state: ProxyState }> = {
  get(target, prop) {
    const { state } = target;
    if (prop === GRAPH_REF) return state.ref;
    if (prop === GRAPH_TYPE) return state.type;
    if (prop === GRAPH_TRAIL) return state.trail;
    if (prop === "selection") {
      return { ref: state.ref, type: state.type } satisfies GraphSelection;
    }
    if (typeof prop === "symbol") return undefined;
    if (prop === "__typename") {
      // Identity field: prefer the ref's own typename, fall back to a cache read.
      return state.ref.__typename ?? readField(state, "__typename");
    }

    const fieldName = prop;
    const fieldDef = state.binding.schema.getField(state.type, fieldName);

    // Callable field (has declared arguments): return a function `(args) => value`.
    if (fieldDef?.args && fieldDef.args.length > 0) {
      return (args?: Record<string, unknown>) => readField(state, fieldName, args);
    }
    return readField(state, fieldName);
  },
  has(target, prop) {
    if (prop === GRAPH_REF || prop === GRAPH_TYPE || prop === GRAPH_TRAIL || prop === "selection") return true;
    return typeof prop === "string" && !!target.state.binding.schema.getField(target.state.type, prop);
  },
  set() {
    throw new Error("graph values are read-only");
  },
  ownKeys() {
    // Graph values are not enumerable/spreadable (brief: spreading is a diagnostic).
    return [];
  },
};

export function createGraphProxy(binding: GraphBinding, ref: GraphRef, type: string, trail: readonly PathStep[] = []): unknown {
  return new Proxy({ state: { binding, ref, type, trail } }, handler);
}

/** Read the hidden selection token off any graph proxy. */
export function selectionOf(value: unknown): GraphSelection | undefined {
  if (value && typeof value === "object" && GRAPH_REF in value) {
    const v = value as { [GRAPH_REF]: GraphRef; [GRAPH_TYPE]: string };
    return { ref: v[GRAPH_REF], type: v[GRAPH_TYPE] };
  }
  return undefined;
}

/** Read the root→value path off any graph proxy (for `usePaginated`/`fetchMore`). */
export function trailOf(value: unknown): readonly PathStep[] | undefined {
  if (value && typeof value === "object" && GRAPH_TRAIL in value) {
    return (value as { [GRAPH_TRAIL]: readonly PathStep[] })[GRAPH_TRAIL];
  }
  return undefined;
}

// --- Bound graph ----------------------------------------------------------

/**
 * The runtime `graph` object: one callable per Query root field, each returning
 * a graph proxy. Root values resolve to the ref the operation seeded (via the
 * `roots` map) so reads hit the warm cache; an unseeded root falls back to a
 * path-identity ref and suspends.
 */
export interface BoundGraph {
  readonly [rootField: string]: (args?: Record<string, unknown>) => unknown;
}

export interface BindGraphOptions {
  readonly schema: SchemaModel;
  readonly getRuntime: () => GraphRuntime;
  /**
   * Root field -> seeded ref, from `runRoute`/`seedResult`. A function form is
   * resolved per call, so the bound graph can follow page-current roots that
   * change across client navigations (the RSC hydrator updates them per nav).
   */
  readonly roots?:
    | Record<string, FieldValue>
    | (() => Record<string, FieldValue> | undefined);
  /**
   * A read tracker scoping this binding's reads to one render (see `GraphBinding`).
   * `useGlean` passes its render's `affected` set so attribution is fiber-local;
   * the server/isomorphic accessor omits it.
   */
  readonly tracker?: Set<string>;
  /**
   * Root fields whose args are computed at the render call-site ("two-sweep").
   * They aren't preloaded; the callable executes them on demand via
   * {@link BindGraphOptions.resolveDeferredRoot}.
   */
  readonly deferredRoots?: ReadonlySet<string>;
  /**
   * Execute a deferred root with its call-site args and return the seeded value
   * (a ref, or an array of refs for a list root). Suspends (throws a promise)
   * until the fetch+seed completes, then returns synchronously on retry. Wired by
   * the integration over `runtime.resolveRoot` + `resolveDeferredRoot`.
   */
  readonly resolveDeferredRoot?: (rootField: string, args: Record<string, unknown> | undefined) => FieldValue;
}

export function bindGraph(options: BindGraphOptions): BoundGraph {
  const binding: GraphBinding = {
    schema: options.schema,
    getRuntime: options.getRuntime,
    ...(options.tracker ? { tracker: options.tracker } : {}),
  };
  const queryType = options.schema.queryType;
  const rootFields = options.schema.getType(queryType)?.fields ?? {};

  const graph: Record<string, (args?: Record<string, unknown>) => unknown> = {};
  for (const [fieldName, fieldDef] of Object.entries(rootFields)) {
    graph[fieldName] = (args?: Record<string, unknown>) => {
      const trail: PathStep[] = [{ name: fieldName, ...(args ? { args } : {}) }];

      // Deferred ("two-sweep") root: args are only known at the render call-site,
      // so execute on demand (suspends until fetched + seeded) instead of reading
      // a preloaded root. This replaces the silent empty-array fallback below for
      // deferred list roots — `glean.nodes({ ids }).map(...)` fetches, not yields [].
      if (options.deferredRoots?.has(fieldName) && options.resolveDeferredRoot) {
        const seededDeferred = options.resolveDeferredRoot(fieldName, args);
        if (fieldDef.list) {
          const items = Array.isArray(seededDeferred) ? seededDeferred : [];
          return items.map((item) => wrap(binding, item, fieldDef.type, trail));
        }
        return wrap(binding, seededDeferred, fieldDef.type, trail);
      }

      const rootsNow =
        typeof options.roots === "function" ? options.roots() : options.roots;
      const seeded = rootsNow?.[fieldName];
      // A list root (`type Query { todos: [Todo!] }`) seeds an array of refs — wrap
      // each as a child proxy so `glean.todos().map(...)` works without an object
      // wrapper. Unseeded (pre-hydration / not yet fetched) -> empty array; the
      // page-pointer re-render fills it once the operation resolves.
      if (fieldDef.list) {
        const items = Array.isArray(seeded) ? seeded : [];
        return items.map((item) => wrap(binding, item, fieldDef.type, trail));
      }
      const ref: GraphRef = isGraphRef(seeded)
        ? seeded
        : { path: `${queryType}.${fieldName}(${canonicalArgs(toArgMap(args))})` };
      return createGraphProxy(binding, ref, fieldDef.type, trail);
    };
  }
  return graph as BoundGraph;
}
