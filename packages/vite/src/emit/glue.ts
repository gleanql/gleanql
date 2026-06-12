import type { RequestScope } from "../types.js";
import { generatedModule, generatedDts, obj, reexports, literal } from "./module.js";
import { renderActiveResolverNullable } from "./resolver.js";

// The generated framework "glue" entrypoints. Each is a THIN SHIM over a typed
// factory in @gleanql/client (`createGraphClient`/`createGraphServer`) — the real
// runtime logic lives there, not in these strings. Three flavours:
//   - genClientJs:    RSC client entry ("use client", private singleton).
//   - genClientSpaJs: isomorphic client entry (shares the app's scope).
//   - genServerJs:    RSC server entry (GraphHydrate + withGraphHydration).

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

const NO_HOOKS: HookCaps = { mutation: false, subscription: false };

/** The client surface both flavours re-export (the first export differs: hydrator vs hydrate). */
const CLIENT_EXPORTS = ["useGlean", "refresh", "runOperation", "onEvent", "appendToRoot", "removeFromRoot", "usePaginated"];

/**
 * The shared body of both client flavours: one `createGraphClient` call with the
 * baked config, then the re-export list. Flavour differences are data — the
 * directive, the scope import/entry, and the leading export.
 */
function clientModule(options: ClientGlueOptions, flavour: { directive?: string; scopeFrom?: string; lead: string }): string {
  const { endpoint, maxCacheRecords, caps = NO_HOOKS, persisted, gcKeepPages, masking } = options;
  const config = obj({
    schema: true,
    operations: true,
    endpoint: literal(endpoint),
    scope: flavour.scopeFrom !== undefined,
    maxCacheRecords: literal(maxCacheRecords),
    persisted: persisted && "true",
    gcKeepPages: literal(gcKeepPages),
    readMask: masking === true,
  });
  return generatedModule({
    directive: flavour.directive,
    imports: [
      `import { createGraphClient } from "../src/glue-client.js";`,
      // Deliberately relative — this copy of the data may go stale mid-session
      // and that is fine: the glue only feeds snapshot-driven hydration (the
      // server serializes per-request data into GraphHydrator props) and
      // browser-initiated wire calls, which servers tolerate across operation
      // generations. A bare self-reference here would break rwsdk's directive
      // scan / vendor-barrel resolution ("No module found ... in module
      // lookup"); the live data path is the server-side accessor module,
      // which DOES use the bare excluded specifier.
      `import { operations, schema${masking ? ", readMask" : ""} } from "./operations.js";`,
      flavour.scopeFrom !== undefined && `import { scope } from ${JSON.stringify(flavour.scopeFrom)}; // the SHARED GraphScope`,
    ],
    body: [
      `const __glean = createGraphClient(${config});`,
      ...reexports("__glean", [
        flavour.lead,
        ...CLIENT_EXPORTS,
        caps.mutation && "useMutation",
        caps.subscription && "useSubscription",
      ]),
    ],
  });
}

/** RSC client entry: a "use client" shim with NO scope — a private singleton runtime the auto-injected <GraphHydrator> feeds. */
export function genClientJs(options: ClientGlueOptions): string {
  return clientModule(options, { directive: `"use client";`, lead: "GraphHydrator" });
}

/**
 * Isomorphic (non-RSC) client entry. NOT a `"use client"` module and owns NO
 * private singleton: it passes the app's SHARED scope (the `requestScope` module)
 * to the factory, so the isomorphic `graph` accessor and `useGlean()` resolve the
 * same runtime per environment. The app drives hydration via `hydrate(payload)`.
 * Requires `requestScope: { import, from }`; that module must export `scope`.
 */
export function genClientSpaJs(requestScope: RequestScope, options: ClientGlueOptions): string {
  if (requestScope === "rwsdk") {
    throw new Error(
      'genClientSpaJs requires requestScope: { import, from } (a non-RSC framework cannot use the "rwsdk" scope).',
    );
  }
  return clientModule(options, { scopeFrom: requestScope.from, lead: "hydrate" });
}

/**
 * The typed `useMutation`/`useSubscription` declarations (selectors typed by the
 * generated accessors). The selector's RETURN is deliberately untied from `TData`:
 * the selector never runs (it only drives compilation, so it may return one read or
 * an array of reads), while `TData` describes the operation's result shape — pass it
 * explicitly to type `data`/`onCompleted`.
 */
function hookDts(caps: HookCaps): Array<string | false> {
  return [
    caps.mutation &&
      `export declare function useMutation<TData = unknown, TVars = Record<string, unknown>>(
  selector: (m: Mutation, vars: TVars) => unknown,
  options?: UseMutationOptions<TData, TVars>,
): UseMutationResult<TData, TVars>;`,
    caps.subscription &&
      `export declare function useSubscription<TData = unknown, TVars = Record<string, unknown>>(
  selector: (s: Subscription, vars: TVars) => unknown,
  options?: UseSubscriptionOptions<TData, TVars>,
): SubscriptionState<TData>;`,
  ];
}

/** The type imports the hook declarations need (option/result types + the root accessors). */
function hookDtsImports(caps: HookCaps): Array<string | false> {
  return [
    caps.mutation && `import type { UseMutationOptions, UseMutationResult } from "../src/glue-client.js";`,
    caps.mutation && `import type { Mutation } from "../index.js";`,
    caps.subscription && `import type { UseSubscriptionOptions, SubscriptionState } from "../src/glue-client.js";`,
    caps.subscription && `import type { Subscription } from "../index.js";`,
  ];
}

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

/** The declarations both client flavours share (everything but the hydration lead + useGlean nullability). */
function clientDtsBody(caps: HookCaps, operationTypes?: string): Array<string | false> {
  return [
    `export declare function refresh(target?: string | { component: string }): Promise<void>;`,
    runOperationDts(operationTypes),
    `export declare function onEvent(listener: (event: import("../src/glue-client.js").GraphClientEvent) => void): () => void;`,
    `export declare function appendToRoot(rootField: string, entity: unknown, options?: { prepend?: boolean; at?: number }): void;`,
    `export declare function removeFromRoot(rootField: string, entity: unknown): void;`,
    `export declare function usePaginated(connection: unknown, options?: UsePaginatedOptions): UsePaginatedResult;`,
    ...hookDts(caps),
  ];
}

const CLIENT_DTS_IMPORTS = [
  `import type { GraphHydrationPayload } from "../src/index.js";`,
  `import type { UsePaginatedOptions, UsePaginatedResult } from "../src/glue-client.js";`,
  `import type { Graph } from "../index.js";`,
];

/** Types for the generated `@gleanql/client/client` (RSC) entrypoint. */
export function genClientDts(caps: HookCaps = NO_HOOKS, operationTypes?: string): string {
  return generatedDts({
    imports: [...CLIENT_DTS_IMPORTS, ...hookDtsImports(caps)],
    body: [
      `export declare function GraphHydrator(props: { payload: GraphHydrationPayload; children?: import("react").ReactNode }): import("react").ReactNode;`,
      `export declare function useGlean(component?: string): Graph | undefined;`,
      ...clientDtsBody(caps, operationTypes),
    ],
  });
}

/** Types for the SPA `@gleanql/client/client` entrypoint. */
export function genClientSpaDts(caps: HookCaps = NO_HOOKS, operationTypes?: string): string {
  // useGlean() is non-optional here: in an isomorphic (non-RSC) host the scope is
  // always installed — server (the per-request runtime via middleware/run) and
  // client (set at hydration before any component renders) — so reads never see an
  // empty graph. (The RSC entry keeps `| undefined`: a client island is rendered
  // server-side for the flight stream before any client runtime exists.)
  return generatedDts({
    imports: [...CLIENT_DTS_IMPORTS, ...hookDtsImports(caps)],
    body: [
      `export declare function hydrate(payload: GraphHydrationPayload | undefined): void;`,
      `export declare function useGlean(component?: string): Graph;`,
      ...clientDtsBody(caps, operationTypes),
    ],
  });
}

/**
 * The `@gleanql/client/testing` entrypoint: the runtime's test harness with the
 * schema baked in — so a consumer test seeds a real graph from plain JSON
 * (`createTestGraph({ data })`) without touching schema plumbing.
 */
export function genTestingJs(): string {
  return generatedModule({
    imports: [`import { schema } from "./operations.js";`, `import { buildTestGraph } from "../src/testing.js";`],
    body: [
      `export const createTestGraph = (options) => buildTestGraph({ schema, ...options });`,
      `export { createMockAdapter, mockGraphFetch } from "../src/testing.js";`,
    ],
  });
}

/** Types for the generated `@gleanql/client/testing` entrypoint. */
export function genTestingDts(): string {
  return generatedDts({
    imports: [
      `import type { Graph } from "../index.js";`,
      `import type { TestGraph, TestGraphOptions } from "../src/testing.js";`,
    ],
    body: [
      `export declare function createTestGraph(options: Omit<TestGraphOptions, "schema">): Omit<TestGraph, "glean"> & { glean: Graph };`,
      `export { createMockAdapter, mockGraphFetch } from "../src/testing.js";`,
      `export type { MockAdapter, MockAdapterCall, MockGraphFetch, MockResponder, TestGraph, TestGraphOptions } from "../src/testing.js";`,
    ],
  });
}

/**
 * RSC server entry: a shim that hands the framework's active-graph resolver + the
 * client hydrator to the shared server factory. `GraphHydrate` serializes this
 * request's cache and renders the client `GraphHydrator` with it (the payload rides
 * the RSC flight stream); `withGraphHydration` is the auto-inject HOC.
 */
export function genServerJs(requestScope: RequestScope = "rwsdk"): string {
  return generatedModule({
    imports: [
      `import { createGraphServer } from "../src/glue-server.js";`,
      `import { GraphHydrator } from "./client.js";`,
      renderActiveResolverNullable(requestScope),
    ],
    body: [
      `const __glean = createGraphServer({ GraphHydrator, getActive: __activeOrNull });`,
      ...reexports("__glean", ["GraphHydrate", "withGraphHydration"]),
    ],
  });
}

/** Types for the generated `@gleanql/client/server` entrypoint. */
export function genServerDts(): string {
  return generatedDts({
    imports: [`import type { ComponentType } from "react";`],
    body: [
      `export declare function GraphHydrate(props?: { clientSafeContext?: readonly string[]; children?: import("react").ReactNode }): unknown;`,
      `export declare function withGraphHydration<P>(Page: ComponentType<P>): ComponentType<P>;`,
    ],
  });
}
