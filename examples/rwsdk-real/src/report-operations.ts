import { buildQuery } from "@gleanql/core";

/**
 * REGISTERED operations — hand-built IR for shapes the compiler doesn't extract
 * from a route. The build RUNS this module (`glean({ operations: "./src/
 * report-operations.ts" })`), prints + hashes each export, and ships it like a
 * compiled operation: same generated map, same persisted allowlist, same
 * `/__glean` overlay. Execute with `runOperation("CollectionReport", { handle })`.
 */
export const CollectionReport = buildQuery(
  "CollectionReport",
  { handle: "String!" },
  (root: any, $: any) => ({
    collection: root.collection({ handle: $.handle }, (c: any) => ({
      title: c.title,
      products: c.products({ first: 50 }, (conn: any) => ({
        nodes: conn.nodes((p: any) => ({
          __typename: p.__typename,
          id: p.id,
          title: p.title,
          views: p.views,
        })),
      })),
    })),
  }),
);
