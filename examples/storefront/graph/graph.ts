import type { Product } from "./schema.js";
import { currentGraph } from "./scope.js";

/**
 * The `graph` accessor. Its typed signatures are what the compiler reads at
 * build time (`graph.product(...)` → `Product`); at runtime the calls delegate
 * to the request-scoped runtime's bound graph, so reads hit the seeded cache and
 * suspend on a miss. App code just writes `graph.product({ handle })`.
 */
export const glean = {
  product(args: { handle: string }): Product {
    return currentGraph().product!(args) as Product;
  },
  components<T extends Record<string, unknown>>(map: T): T {
    return map;
  },
};
