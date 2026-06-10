import type { GraphRuntime } from "./runtime.js";
import type { GraphClientAdapter, GraphRequestContext } from "./adapter.js";
import { runMutation, type MutationResult } from "./mutation.js";

/** The minimal operation shape the mutator needs (any CompiledOperation satisfies it). */
export interface MutationOperationLike {
  readonly name: string;
  readonly kind: "query" | "mutation" | "subscription";
  readonly document: string;
}

/**
 * The `graph.mutate.*` namespace.
 *
 * Mutations are compiled operations like queries; this binds one callable per
 * compiled mutation operation so app code writes:
 *
 *   await graph.mutate.cartLinesAdd({ cartId, lines }, {
 *     optimistic: (tx) => tx.set(cartRef, "totalQuantity", n + 1),
 *     invalidate: (data) => [cartRef],
 *   });
 *
 * Each call runs the mutation, folds the result into the cache, and applies the
 * optimistic/invalidation policy (see runMutation).
 */
export type MutateFn = (
  variables: Record<string, unknown>,
  options?: Omit<Parameters<typeof runMutation>[0], "operation" | "variables" | "adapter" | "context" | "runtime">,
) => Promise<MutationResult>;

export type BoundMutations = Record<string, MutateFn>;

export interface CreateMutatorOptions {
  /** Compiled operations; only `kind: "mutation"` entries are bound. */
  readonly operations: Record<string, MutationOperationLike>;
  readonly adapter: GraphClientAdapter;
  readonly runtime: GraphRuntime;
  /** The request context (auth/locale/env) passed to the transport. */
  readonly context: GraphRequestContext;
}

export function createMutator(options: CreateMutatorOptions): BoundMutations {
  const mutate: BoundMutations = {};
  for (const [name, operation] of Object.entries(options.operations)) {
    if (operation.kind !== "mutation") continue;
    const mutationOp = { name: operation.name, kind: "mutation" as const, document: operation.document };
    mutate[name] = (variables, opts) =>
      runMutation({
        operation: mutationOp,
        variables,
        adapter: options.adapter,
        context: options.context,
        runtime: options.runtime,
        ...opts,
      });
  }
  return mutate;
}
