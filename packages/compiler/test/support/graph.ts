import type { Product, Cart, Collection, SearchResultConnection } from "./schema.js";

// Generated-style graph root accessor. Each root returns a graph-backed value;
// the runtime replaces these stubs with proxies. `graph.components` registers a
// statically-analyzable dynamic-component set.

export const glean = {
  product(_args: { handle: string }): Product {
    return undefined as unknown as Product;
  },
  cart(_args: { id: string }): Cart {
    return undefined as unknown as Cart;
  },
  collection(_args: { handle: string }): Collection {
    return undefined as unknown as Collection;
  },
  search(_args: { query: string }): SearchResultConnection {
    return undefined as unknown as SearchResultConnection;
  },
  components<T extends Record<string, unknown>>(map: T): T {
    return map;
  },
};

/** The Mutation-root accessor: one callable per mutation field (compile-time stub). */
export interface Mutation {
  setProductTitle(args: { id: string; title: string }): Product;
}

/** gqty-style mutation hook — the selector compiles to a `kind:"mutation"` op. */
export function useMutation<TData, TVars>(
  _selector: (m: Mutation, vars: TVars) => TData,
): [(vars: TVars) => Promise<{ data?: TData }>, { isLoading: boolean }] {
  return [async () => ({}), { isLoading: false }];
}

/** The Subscription-root accessor: one callable per subscription field (compile-time stub). */
export interface Subscription {
  productChanged(args: { handle: string }): Product;
}

/** gqty-style subscription hook — the selector compiles to a `kind:"subscription"` op. */
export function useSubscription<TData, TVars>(
  _selector: (s: Subscription, vars: TVars) => TData,
): { data: TData | undefined; error: string | undefined } {
  return { data: undefined, error: undefined };
}

/** Lazy boundary: reads inside are excluded from the initial operation. */
export function GraphLazy(props: { children?: unknown }): unknown {
  return props.children;
}
