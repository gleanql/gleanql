import type { OperationIR, SelectionSet } from "./ir.js";
import { sha256Hex } from "./sha256.js";

/**
 * A compiled operation artifact carries more than the GraphQL document: it
 * bundles the variables factory, the per-component read map, and devtools
 * metadata. This is what a framework adapter loads to drive a route.
 */
export interface ReadMap {
  readonly [componentName: string]: readonly string[];
}

export interface OperationArtifact {
  readonly name: string;
  readonly kind: OperationIR["kind"];
  /** Printed GraphQL document. */
  readonly document: string;
  /** Stable content hash of the document (for persisted queries / devtools). */
  readonly hash: string;
  /** Source of the variables factory (TypeScript), and its export name. */
  readonly variablesFactory: {
    readonly exportName: string;
    readonly source: string;
  };
  readonly readMap: ReadMap;
  /** Merged selection tree — lets the runtime check cache coverage (cache-first). */
  readonly selection: SelectionSet;
  /** The operation's variable definitions — drives generated `variables` types. */
  readonly variableDefs?: readonly { readonly name: string; readonly type: string }[];
  /**
   * True when one or more root reads take arguments computed at render time
   * (the "two-sweep" pattern), so they cannot be preloaded from `ctx` and must
   * execute at the call site with the supplied args. See `runtimeVars`.
   */
  readonly deferred?: boolean;
  /**
   * Names of the operation variables ($vars) that are supplied at the render
   * call-site rather than by the `getXVariables(ctx)` preload factory. The
   * factory omits these; the runtime binds them from the in-render call args.
   */
  readonly runtimeVars?: readonly string[];
  /** Originating route/module file. */
  readonly source?: string;
  readonly stats: OperationStats;
}

export interface OperationStats {
  readonly fieldCount: number;
  readonly rootCount: number;
  readonly connectionCount: number;
}

/**
 * Stable content hash of a document: SHA-256 hex — the persisted-operation ID.
 * The same value rides the compiled operation, the build's persisted manifest,
 * and the wire request (`extensions.persistedQuery.sha256Hash`), and matches
 * what Apollo-style servers compute server-side.
 */
export function hashDocument(document: string): string {
  return sha256Hex(document);
}
