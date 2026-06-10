import type { RequestScope } from "../types.js";
import { renderActiveResolverNullable } from "./resolver.js";

// The generated framework "glue" entrypoints. Each is a THIN SHIM over a typed
// factory in @gleanql/client (`createGraphClient`/`createGraphServer`) — the real
// runtime logic lives there, not in these strings. Three flavours:
//   - genClientJs:    RSC client entry ("use client", private singleton).
//   - genClientSpaJs: isomorphic client entry (shares the app's scope).
//   - genServerJs:    RSC server entry (GraphHydrate + withGraphHydration).

/** `, maxCacheRecords: N` fragment for the createGraphClient config (empty when unset). */
function cacheCapArg(maxCacheRecords?: number): string {
  return typeof maxCacheRecords === "number" ? `, maxCacheRecords: ${JSON.stringify(maxCacheRecords)}` : "";
}

/** `, persisted: true` fragment for the createGraphClient config (empty when off). */
function persistedArg(persisted?: boolean): string {
  return persisted ? ", persisted: true" : "";
}

/** `, gcKeepPages: N` fragment for the createGraphClient config (empty when unset). */
function gcArg(gcKeepPages?: number): string {
  return typeof gcKeepPages === "number" ? `, gcKeepPages: ${JSON.stringify(gcKeepPages)}` : "";
}

/** Which selector hooks the schema warrants emitting. */
export interface HookCaps {
  readonly mutation: boolean;
  readonly subscription: boolean;
}

/** Config baked into a generated client glue entry (the shared shape of both flavours). */
export interface ClientGlueOptions {
  /** URL the client POSTs to for refetch. */
  readonly endpoint: string;
  /** Optional LRU cap baked into the client cache. */
  readonly maxCacheRecords?: number;
  /** Which selector hooks to re-export (defaults to none). */
  readonly caps?: HookCaps;
  /** Send operations by sha-256 hash (persisted-operation mode). */
  readonly persisted?: boolean;
  /** Staleness-aware GC: collect unretained records untouched for N page generations. */
  readonly gcKeepPages?: number;
  /** Dev read-masking: bake the generated readMask into the client config. */
  readonly masking?: boolean;
}

/** JS re-exports for the selector hooks the schema warrants. */
function hookExports(caps: HookCaps): string {
  return (
    (caps.mutation ? `\nexport const useMutation = __glean.useMutation;` : "") +
    (caps.subscription ? `\nexport const useSubscription = __glean.useSubscription;` : "")
  );
}

/**
 * The typed `useMutation`/`useSubscription` declarations (selectors typed by the
 * generated accessors). The selector's RETURN is deliberately untied from `TData`:
 * the selector never runs (it only drives compilation, so it may return one read or
 * an array of reads), while `TData` describes the operation's result shape — pass it
 * explicitly to type `data`/`onCompleted`.
 */
function hookDts(caps: HookCaps): string {
  const m = caps.mutation
    ? `
export declare function useMutation<TData = unknown, TVars = Record<string, unknown>>(
  selector: (m: Mutation, vars: TVars) => unknown,
  options?: UseMutationOptions<TData, TVars>,
): UseMutationResult<TData, TVars>;`
    : "";
  const s = caps.subscription
    ? `
export declare function useSubscription<TData = unknown, TVars = Record<string, unknown>>(
  selector: (s: Subscription, vars: TVars) => unknown,
  options?: UseSubscriptionOptions<TData, TVars>,
): SubscriptionState<TData>;`
    : "";
  return m + s;
}

/** The type imports the hook declarations need (option/result types + the root accessors). */
function hookDtsImports(caps: HookCaps): string {
  const lines: string[] = [];
  if (caps.mutation) {
    lines.push(`import type { UseMutationOptions, UseMutationResult } from "../src/glue-client.js";`);
    lines.push(`import type { Mutation } from "../index.js";`);
  }
  if (caps.subscription) {
    lines.push(`import type { UseSubscriptionOptions, SubscriptionState } from "../src/glue-client.js";`);
    lines.push(`import type { Subscription } from "../index.js";`);
  }
  return lines.length ? `\n${lines.join("\n")}` : "";
}

const NO_HOOKS: HookCaps = { mutation: false, subscription: false };

/**
 * The `runOperation` declaration: typed by name through the generated
 * `GleanOperations` interface (variables AND data per operation) when the
 * caller provides one, with an untyped overload for dynamic names.
 */
function runOperationDts(operationTypes?: string): string {
  const fallback = `export declare function runOperation(name: string, variables?: Record<string, unknown>): Promise<{ data?: unknown; errors?: ReadonlyArray<{ message: string }> }>;`;
  if (!operationTypes) return fallback;
  return `${operationTypes}
export declare function runOperation<K extends keyof GleanOperations>(name: K, variables: GleanOperations[K]["variables"]): Promise<{ data?: GleanOperations[K]["data"]; errors?: ReadonlyArray<{ message: string }> }>;
${fallback}`;
}

/** RSC client entry: a "use client" shim with NO scope — a private singleton runtime the auto-injected <GraphHydrator> feeds. */
export function genClientJs({ endpoint, maxCacheRecords, caps = NO_HOOKS, persisted, gcKeepPages, masking }: ClientGlueOptions): string {
  return `// GENERATED by @gleanql/vite — do not edit.
"use client";
import { createGraphClient } from "../src/glue-client.js";
import { operations, schema${masking ? ", readMask" : ""} } from "./operations.js";

const __glean = createGraphClient({ schema, operations, endpoint: ${JSON.stringify(endpoint)}${cacheCapArg(maxCacheRecords)}${persistedArg(persisted)}${gcArg(gcKeepPages)}${masking ? ", readMask" : ""} });
export const GraphHydrator = __glean.GraphHydrator;
export const useGlean = __glean.useGlean;
export const refresh = __glean.refresh;
export const runOperation = __glean.runOperation;
export const onEvent = __glean.onEvent;
export const appendToRoot = __glean.appendToRoot;
export const removeFromRoot = __glean.removeFromRoot;
export const usePaginated = __glean.usePaginated;${hookExports(caps)}
`;
}

/** Types for the generated `@gleanql/client/client` (RSC) entrypoint. */
export function genClientDts(caps: HookCaps = NO_HOOKS, operationTypes?: string): string {
  return `// GENERATED — do not edit.
import type { GraphHydrationPayload } from "../src/index.js";
import type { UsePaginatedOptions, UsePaginatedResult } from "../src/glue-client.js";
import type { Graph } from "../index.js";${hookDtsImports(caps)}
export declare function GraphHydrator(props: { payload: GraphHydrationPayload }): null;
export declare function useGlean(component?: string): Graph | undefined;
export declare function refresh(target?: string | { component: string }): Promise<void>;
${runOperationDts(operationTypes)}
export declare function onEvent(listener: (event: import("../src/glue-client.js").GraphClientEvent) => void): () => void;
export declare function appendToRoot(rootField: string, entity: unknown, options?: { prepend?: boolean; at?: number }): void;
export declare function removeFromRoot(rootField: string, entity: unknown): void;
export declare function usePaginated(connection: unknown, options?: UsePaginatedOptions): UsePaginatedResult;${hookDts(caps)}
`;
}

/**
 * The `@gleanql/client/testing` entrypoint: the runtime's test harness with the
 * schema baked in — so a consumer test seeds a real graph from plain JSON
 * (`createTestGraph({ data })`) without touching schema plumbing.
 */
export function genTestingJs(): string {
  return `// GENERATED by @gleanql/vite — do not edit.
import { schema } from "./operations.js";
import { buildTestGraph } from "../src/testing.js";

export const createTestGraph = (options) => buildTestGraph({ schema, ...options });
export { createMockAdapter, mockGraphFetch } from "../src/testing.js";
`;
}

/** Types for the generated `@gleanql/client/testing` entrypoint. */
export function genTestingDts(): string {
  return `// GENERATED — do not edit.
import type { Graph } from "../index.js";
import type { TestGraph, TestGraphOptions } from "../src/testing.js";
export declare function createTestGraph(options: Omit<TestGraphOptions, "schema">): Omit<TestGraph, "glean"> & { glean: Graph };
export { createMockAdapter, mockGraphFetch } from "../src/testing.js";
export type { MockAdapter, MockAdapterCall, MockGraphFetch, MockResponder, TestGraph, TestGraphOptions } from "../src/testing.js";
`;
}

/**
 * RSC server entry: a shim that hands the framework's active-graph resolver + the
 * client hydrator to the shared server factory. `GraphHydrate` serializes this
 * request's cache and renders the client `GraphHydrator` with it (the payload rides
 * the RSC flight stream); `withGraphHydration` is the auto-inject HOC.
 */
export function genServerJs(requestScope: RequestScope = "rwsdk"): string {
  return `// GENERATED by @gleanql/vite — do not edit.
import { createGraphServer } from "../src/glue-server.js";
import { GraphHydrator } from "./client.js";
${renderActiveResolverNullable(requestScope)}

const __glean = createGraphServer({ GraphHydrator, getActive: __activeOrNull });
export const GraphHydrate = __glean.GraphHydrate;
export const withGraphHydration = __glean.withGraphHydration;
`;
}

/** Types for the generated `@gleanql/client/server` entrypoint. */
export function genServerDts(): string {
  return `// GENERATED — do not edit.
import type { ComponentType } from "react";
export declare function GraphHydrate(props?: { clientSafeContext?: readonly string[] }): unknown;
export declare function withGraphHydration<P>(Page: ComponentType<P>): ComponentType<P>;
`;
}

/**
 * Isomorphic (non-RSC) client entry. NOT a `"use client"` module and owns NO
 * private singleton: it passes the app's SHARED scope (the `requestScope` module)
 * to the factory, so the isomorphic `graph` accessor and `useGlean()` resolve the
 * same runtime per environment. The app drives hydration via `hydrate(payload)`.
 * Requires `requestScope: { import, from }`; that module must export `scope`.
 */
export function genClientSpaJs(
  requestScope: RequestScope,
  { endpoint, maxCacheRecords, caps = NO_HOOKS, persisted, gcKeepPages, masking }: ClientGlueOptions,
): string {
  if (requestScope === "rwsdk") {
    throw new Error(
      'genClientSpaJs requires requestScope: { import, from } (a non-RSC framework cannot use the "rwsdk" scope).',
    );
  }
  return `// GENERATED by @gleanql/vite — do not edit.
import { createGraphClient } from "../src/glue-client.js";
import { operations, schema${masking ? ", readMask" : ""} } from "./operations.js";
import { scope } from ${JSON.stringify(requestScope.from)}; // the SHARED GraphScope

const __glean = createGraphClient({ schema, operations, endpoint: ${JSON.stringify(endpoint)}, scope${cacheCapArg(maxCacheRecords)}${persistedArg(persisted)}${gcArg(gcKeepPages)}${masking ? ", readMask" : ""} });
export const hydrate = __glean.hydrate;
export const useGlean = __glean.useGlean;
export const refresh = __glean.refresh;
export const runOperation = __glean.runOperation;
export const onEvent = __glean.onEvent;
export const appendToRoot = __glean.appendToRoot;
export const removeFromRoot = __glean.removeFromRoot;
export const usePaginated = __glean.usePaginated;${hookExports(caps)}
`;
}

/** Types for the SPA `@gleanql/client/client` entrypoint. */
export function genClientSpaDts(caps: HookCaps = NO_HOOKS, operationTypes?: string): string {
  // useGlean() is non-optional here: in an isomorphic (non-RSC) host the scope is
  // always installed — server (the per-request runtime via middleware/run) and
  // client (set at hydration before any component renders) — so reads never see an
  // empty graph. (The RSC entry keeps `| undefined`: a client island is rendered
  // server-side for the flight stream before any client runtime exists.)
  return `// GENERATED — do not edit.
import type { GraphHydrationPayload } from "../src/index.js";
import type { UsePaginatedOptions, UsePaginatedResult } from "../src/glue-client.js";
import type { Graph } from "../index.js";${hookDtsImports(caps)}
export declare function hydrate(payload: GraphHydrationPayload | undefined): void;
export declare function useGlean(component?: string): Graph;
export declare function refresh(target?: string | { component: string }): Promise<void>;
${runOperationDts(operationTypes)}
export declare function onEvent(listener: (event: import("../src/glue-client.js").GraphClientEvent) => void): () => void;
export declare function appendToRoot(rootField: string, entity: unknown, options?: { prepend?: boolean; at?: number }): void;
export declare function removeFromRoot(rootField: string, entity: unknown): void;
export declare function usePaginated(connection: unknown, options?: UsePaginatedOptions): UsePaginatedResult;${hookDts(caps)}
`;
}
