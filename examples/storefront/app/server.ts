import { buildSchema, graphql } from "graphql";
import type { GraphClientAdapter } from "@gleanql/client";

/**
 * An in-memory GraphQL server (graphql-js) standing in for a real endpoint. The
 * compiled operation is *actually executed* against this schema — proving the
 * generated document is valid, executable GraphQL — and the result seeds the
 * runtime cache. Implements the `GraphClientAdapter` seam directly (a real app
 * would use `createFetchAdapter`).
 */
const schema = buildSchema(/* GraphQL */ `
  type Query { product(handle: String!): Product }
  type Product {
    id: ID!
    handle: String!
    title: String!
    descriptionHtml: String!
    featuredImage: Image
    priceRange: ProductPriceRange!
    views: Int!
  }
  type Image { url: String!  altText: String }
  type ProductPriceRange { minVariantPrice: MoneyV2! }
  type MoneyV2 { amount: String!  currencyCode: String! }
`);

const PRODUCTS: Record<string, Record<string, unknown>> = {
  "cool-shirt": {
    id: "gid://shopify/Product/cool-shirt",
    handle: "cool-shirt",
    title: "Cool Shirt",
    descriptionHtml: "<p>A genuinely cool shirt.</p>",
    featuredImage: { url: "https://cdn.example/cool-shirt.png", altText: "A cool shirt" },
    priceRange: { minVariantPrice: { amount: "29.00", currencyCode: "USD" } },
  },
};

/** Count how many network round-trips happened (to show hydration avoids refetches). */
export interface ServerStats {
  requests: number;
}

/** An adapter whose `execute` runs the operation against the in-memory schema. */
export function makeGraphAdapter(stats: ServerStats): GraphClientAdapter {
  // Per-adapter counter: `views` changes on every fetch, so a refetch is
  // visibly different from the hydrated value.
  let viewCount = 0;
  const rootValue = {
    product: ({ handle }: { handle: string }) => {
      const p = PRODUCTS[handle];
      return p ? { ...p, views: ++viewCount } : null;
    },
  };
  return {
    async execute(operation, variables) {
      stats.requests++;
      const res = await graphql({
        schema,
        source: operation.document,
        variableValues: variables as Record<string, unknown>,
        rootValue,
      });
      return { data: res.data ?? undefined, errors: res.errors?.map((e) => ({ message: e.message })) } as never;
    },
  };
}
