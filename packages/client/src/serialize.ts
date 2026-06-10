import {
  GraphRuntime,
  bindGraph,
  type BoundGraph,
  type FieldValue,
  type GraphClientAdapter,
  type GraphRequestContext,
  type GraphScope,
  type MissingFieldMode,
  type MissingFieldRead,
  type MissingFieldResult,
} from "./index.js";
import type { SchemaModel } from "@gleanql/core";
import type { ActiveRequestGraph } from "./integration.js";

/**
 * Server -> client serialization.
 *
 * Graph values are proxies, not JSON, so we don't serialize them. We serialize
 * the *cache* (normalized records + path records) plus the root refs and the
 * operation identity. On the client we rebuild a runtime from that snapshot and
 * re-bind the graph, so client components read the same fields with cache hits;
 * fields absent from the snapshot fetch through the client adapter.
 *
 * Secrets stay server-side: only `clientSafeContext` keys are serialized.
 */
export interface GraphHydrationPayload {
  readonly operationName: string;
  readonly variables: Record<string, unknown>;
  readonly snapshot: Record<string, Record<string, FieldValue>>;
  readonly roots: Record<string, FieldValue>;
  /** Allow-listed, client-safe slice of the request context. */
  readonly context: Record<string, unknown>;
}

export interface SerializeGraphOptions {
  /** Keys of the request context that are safe to ship to the client. */
  readonly clientSafeContext?: readonly string[];
}

/** Build the JSON-safe hydration payload from an active request. */
export function serializeGraph(
  active: ActiveRequestGraph,
  options: SerializeGraphOptions = {},
): GraphHydrationPayload {
  const allow = new Set(options.clientSafeContext ?? []);
  const context: Record<string, unknown> = {};
  for (const key of allow) {
    if (key in active.requestContext) context[key] = active.requestContext[key];
  }
  return {
    operationName: active.operation.name,
    variables: active.variables,
    snapshot: active.runtime.snapshot(),
    roots: active.roots,
    context,
  };
}

const DEFAULT_GLOBAL = "__GRAPH_STATE__";

/**
 * Render a `<script>` that publishes the payload on `window[globalKey]` for
 * client hydration. JSON is escaped so it cannot break out of the script element
 * or be interpreted as HTML (`<`, `>`, `&`, U+2028/U+2029).
 */
export function renderGraphHydrationScript(
  payload: GraphHydrationPayload,
  options: { globalKey?: string; nonce?: string } = {},
): string {
  const nonceAttr = options.nonce ? ` nonce="${options.nonce}"` : "";
  return `<script${nonceAttr}>${graphHydrationScriptContent(payload, options.globalKey)}</script>`;
}

/**
 * Just the inner JS of the hydration script (no `<script>` wrapper), for JSX
 * hosts that inject via `dangerouslySetInnerHTML` and set the nonce themselves.
 * JSON is escaped so it can't break out of the script element or be parsed as HTML.
 */
export function graphHydrationScriptContent(payload: GraphHydrationPayload, globalKey = DEFAULT_GLOBAL): string {
  const json = JSON.stringify(payload)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  return `window[${JSON.stringify(globalKey)}]=${json}`;
}

/** Read the hydration payload published by `renderGraphHydrationScript` (client). */
export function readGraphHydrationPayload(globalKey = DEFAULT_GLOBAL): GraphHydrationPayload | undefined {
  const g = globalThis as Record<string, unknown>;
  return g[globalKey] as GraphHydrationPayload | undefined;
}

export interface HydrateGraphOptions {
  readonly schema: SchemaModel;
  readonly adapter: GraphClientAdapter;
  /** Fetch fields absent from the hydrated snapshot (lazy/dynamic reads). */
  readonly fetchMissing?: (
    misses: readonly MissingFieldRead[],
    context: GraphRequestContext,
  ) => Promise<readonly MissingFieldResult[]>;
  readonly unexpectedMissingField?: MissingFieldMode;
  readonly onWarn?: (message: string) => void;
  /** Install the hydrated runtime on this scope as the client singleton. */
  readonly scope?: GraphScope;
}

export interface HydratedGraph {
  readonly runtime: GraphRuntime;
  readonly graph: BoundGraph;
  readonly roots: Record<string, FieldValue>;
  readonly context: Record<string, unknown>;
}

/**
 * Rebuild the runtime + bound graph on the client from a hydration payload.
 * Reads present in the snapshot resolve synchronously; missing fields suspend and
 * fetch through the client adapter.
 */
export function hydrateGraph(payload: GraphHydrationPayload, options: HydrateGraphOptions): HydratedGraph {
  const runtime = GraphRuntime.hydrate(payload.snapshot, {
    keyOf: (typename, obj) => options.schema.identityOf(typename, obj),
    unexpectedMissingField: options.unexpectedMissingField,
    onWarn: options.onWarn,
    fetchMissing: async (misses) =>
      options.fetchMissing ? options.fetchMissing(misses, payload.context) : misses.map((m) => ({ ref: m.ref, fieldKey: m.fieldKey, value: undefined })),
  });
  const graph = bindGraph({ schema: options.schema, getRuntime: () => runtime, roots: payload.roots });
  const active: HydratedGraph = { runtime, graph, roots: payload.roots, context: payload.context };
  options.scope?.set({ runtime, graph });
  return active;
}

/**
 * RSC-native hydration (vs. the `<script>`/`window` model above).
 *
 * Under React Server Components the `Document` shell is rendered once, but each
 * client navigation re-streams only the page subtree. So a one-shot global can't
 * keep client islands warm across navigation. Instead the payload rides the RSC
 * flight stream as a prop of a client component (it is plain JSON by
 * construction), and on every (re)render that component folds it into a single
 * long-lived client runtime — the cache accumulates across navigations.
 */

/** The page-current pointer islands read for `refresh()` (which operation + vars). */
export interface GraphPagePointer {
  readonly operationName: string;
  readonly variables: Record<string, unknown>;
  readonly context: Record<string, unknown>;
  readonly roots: Record<string, FieldValue>;
}

/**
 * Render-phase merge: fold a payload's snapshot into a live runtime, write-only
 * (no subscriber notify — the caller bumps in a commit-phase effect). Idempotent.
 * Returns whether anything changed.
 */
export function absorbHydrationPayload(
  runtime: GraphRuntime,
  payload: GraphHydrationPayload,
): boolean {
  return runtime.absorbRecords(payload.snapshot);
}

/** Derive the current-page pointer from a payload (drives `refresh()`). */
export function pagePointer(payload: GraphHydrationPayload): GraphPagePointer {
  return {
    operationName: payload.operationName,
    variables: payload.variables,
    context: payload.context,
    roots: payload.roots,
  };
}
