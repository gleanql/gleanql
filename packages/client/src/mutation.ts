import { GraphCache, type GraphRef, type FieldValue } from "./cache.js";
import type { GraphRuntime } from "./runtime.js";
import type { GraphClientAdapter, GraphRequestContext } from "./adapter.js";
import type { CompiledOperation } from "./route.js";
import { selectionOf } from "./proxy.js";

/**
 * Mutations + invalidation.
 *
 * Reads were the first milestone; this is the write side. A mutation is run
 * through the same client adapter as a query, and its result is normalized into
 * the cache — so any entity it returns (`__typename + id`) updates *in place* and
 * every read of that entity, through any path, reflects the change for free.
 * That is the payoff of the normalized cache the brief asked for.
 *
 * On top of that the engine adds: GraphQL-style `userErrors`, optimistic writes
 * with automatic rollback, and invalidation of affected graph values/roots.
 */

/** A GraphQL `userErrors` entry (Shopify-style mutation payloads). */
export interface UserError {
  readonly field?: readonly string[];
  readonly message: string;
  readonly code?: string;
}

export interface MutationResult<TData = unknown> {
  readonly data?: TData;
  /** Logical, per-mutation errors returned in the payload (not transport errors). */
  readonly userErrors: readonly UserError[];
  /** Transport/GraphQL execution errors. */
  readonly errors?: ReadonlyArray<{ message: string }>;
  /** True when there were no transport errors and no userErrors. */
  readonly ok: boolean;
}

/**
 * A reversible batch of cache writes. Optimistic updates record the prior value
 * of every field they touch so the whole batch can be rolled back if the
 * mutation fails (transport error or `userErrors`).
 */
export class MutationTransaction {
  private readonly undo: Array<() => void> = [];

  constructor(private readonly cache: GraphCache) {}

  /** Optimistically write a field, remembering how to undo it. */
  set(ref: GraphRef, fieldKey: string, value: FieldValue): void {
    const before = this.cache.getField(ref, fieldKey);
    if (before.status === "ready") {
      const prev = before.value;
      this.undo.push(() => this.cache.setField(ref, fieldKey, prev));
    } else {
      this.undo.push(() => this.cache.invalidateField(ref, fieldKey));
    }
    this.cache.setField(ref, fieldKey, value);
  }

  /** Roll back every write in reverse order. */
  rollback(): void {
    for (let i = this.undo.length - 1; i >= 0; i--) this.undo[i]!();
    this.undo.length = 0;
  }
}

export interface RunMutationOptions<TData = unknown> {
  readonly operation: CompiledOperation<unknown, Record<string, unknown>> | {
    readonly name: string;
    readonly kind: "mutation";
    readonly document: string;
  };
  readonly variables: Record<string, unknown>;
  readonly adapter: GraphClientAdapter;
  readonly context: GraphRequestContext;
  readonly runtime: GraphRuntime;
  /** Optimistically patch the cache before the request; rolled back on failure. */
  readonly optimistic?: (tx: MutationTransaction) => void;
  /** Apply the server result (e.g. prepend to a connection) after normalization. */
  readonly update?: (data: TData, tx: MutationTransaction) => void;
  /** Graph values / refs to invalidate on success (refetch on next read). */
  readonly invalidate?: (data: TData) => ReadonlyArray<GraphRef | unknown>;
}

/**
 * Execute a mutation, normalize its result into the cache, surface userErrors,
 * and apply optimistic/invalidation policy. The returned promise never rejects
 * for logical failures — inspect `ok`/`userErrors`/`errors`.
 */
export async function runMutation<TData = Record<string, unknown>>(
  options: RunMutationOptions<TData>,
): Promise<MutationResult<TData>> {
  const { runtime, adapter, context, variables } = options;
  const tx = new MutationTransaction(runtime.cache);
  if (options.optimistic) options.optimistic(tx);

  let result;
  try {
    result = await adapter.execute(
      { name: options.operation.name, kind: "mutation", document: options.operation.document },
      variables,
      context,
    );
  } catch (error) {
    tx.rollback();
    return { userErrors: [], errors: [{ message: errorMessage(error) }], ok: false };
  }

  if (result.errors && result.errors.length > 0) {
    tx.rollback();
    return { userErrors: [], errors: result.errors, ok: false };
  }

  const data = result.data as TData | undefined;
  const userErrors = data ? extractUserErrors(data as Record<string, unknown>) : [];

  if (userErrors.length > 0) {
    // The server rejected the change: undo the optimistic patch and report.
    tx.rollback();
    return { data, userErrors, ok: false };
  }

  // Success: fold the server result into the cache (entities update in place).
  if (data) runtime.seedResult(data as Record<string, unknown>);
  if (options.update && data) options.update(data, tx);

  if (options.invalidate && data) {
    for (const target of options.invalidate(data)) {
      const ref = toRef(target);
      if (ref) runtime.invalidate(ref);
    }
  }

  return { data, userErrors: [], ok: true };
}

/** Invalidate a record by graph value (proxy) or raw ref — next read re-fetches. */
export function invalidateValue(runtime: GraphRuntime, value: GraphRef | unknown): void {
  const ref = toRef(value);
  if (ref) runtime.invalidate(ref);
}

/** Collect `userErrors` from each top-level mutation payload in the result. */
function extractUserErrors(data: Record<string, unknown>): UserError[] {
  const out: UserError[] = [];
  for (const value of Object.values(data)) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const ue = (value as Record<string, unknown>).userErrors;
      if (Array.isArray(ue)) {
        for (const e of ue) {
          if (e && typeof e === "object") out.push(e as UserError);
        }
      }
    }
  }
  return out;
}

function toRef(value: GraphRef | unknown): GraphRef | undefined {
  const selection = selectionOf(value);
  if (selection) return selection.ref;
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if ((v.__typename != null && v.id != null) || typeof v.path === "string") return v as GraphRef;
  }
  return undefined;
}

/** One rule for stringifying unknown errors, shared across hooks and transports. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
