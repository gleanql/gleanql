import { buildSchema, graphql } from "graphql";
import type { GraphClientAdapter } from "@gleanql/client";

/**
 * The shared in-memory storefront server used by every example.
 *
 * It's a tiny graphql-js executor that implements the `GraphClientAdapter` seam
 * directly (in a real app `execute` would POST to your API; here it runs in-process
 * so an example needs no network). Keeping it here means the examples carry no
 * server of their own — they import {@link makeGraphAdapter} / {@link executeGraphQL}
 * and point the `@gleanql/vite` plugin at this package's `schema.graphql`.
 *
 * `storefrontSDL` must stay in sync with `schema.graphql` (a vitest checks this).
 */
export const storefrontSDL = /* GraphQL */ `
  type Query {
    product(handle: String!): Product
    collection(handle: String!): Collection
  }
  type Mutation {
    setProductTitle(id: ID!, title: String!): Product
  }
  type Subscription {
    productChanged(handle: String!): Product
  }
  type Collection { id: ID!  handle: String!  title: String!  products(first: Int!, after: String): ProductConnection! }
  type ProductConnection { nodes: [Product!]!  pageInfo: PageInfo! }
  type PageInfo { hasNextPage: Boolean!  endCursor: String }
  type Product { id: ID!  handle: String!  title: String!  descriptionHtml: String!  featuredImage: Image  priceRange: ProductPriceRange!  views: Int! }
  type Image { url: String!  altText: String }
  type ProductPriceRange { minVariantPrice: MoneyV2! }
  type MoneyV2 { amount: String!  currencyCode: String! }
`;

const schema = buildSchema(storefrontSDL);

const PRODUCTS: Record<string, Record<string, unknown>> = {
  "cool-shirt": {
    id: "gid://shopify/Product/cool-shirt",
    handle: "cool-shirt",
    title: "Cool Shirt",
    descriptionHtml: "<p>A genuinely cool shirt.</p>",
    featuredImage: { url: "https://cdn.example/cool-shirt.png", altText: "A cool shirt" },
    priceRange: { minVariantPrice: { amount: "29.00", currencyCode: "USD" } },
  },
  "warm-hat": {
    id: "gid://shopify/Product/warm-hat",
    handle: "warm-hat",
    title: "Warm Hat",
    descriptionHtml: "<p>Stays on in the wind.</p>",
    featuredImage: { url: "https://cdn.example/warm-hat.png", altText: "A warm hat" },
    priceRange: { minVariantPrice: { amount: "19.50", currencyCode: "USD" } },
  },
  "rugged-boots": {
    id: "gid://shopify/Product/rugged-boots",
    handle: "rugged-boots",
    title: "Rugged Boots",
    descriptionHtml: "<p>For long trails.</p>",
    featuredImage: { url: "https://cdn.example/rugged-boots.png", altText: "Rugged boots" },
    priceRange: { minVariantPrice: { amount: "120.00", currencyCode: "USD" } },
  },
  "canvas-bag": {
    id: "gid://shopify/Product/canvas-bag",
    handle: "canvas-bag",
    title: "Canvas Bag",
    descriptionHtml: "<p>Carries everything.</p>",
    featuredImage: { url: "https://cdn.example/canvas-bag.png", altText: "A canvas bag" },
    priceRange: { minVariantPrice: { amount: "45.00", currencyCode: "USD" } },
  },
  "wool-socks": {
    id: "gid://shopify/Product/wool-socks",
    handle: "wool-socks",
    title: "Wool Socks",
    descriptionHtml: "<p>Warm and soft.</p>",
    featuredImage: { url: "https://cdn.example/wool-socks.png", altText: "Wool socks" },
    priceRange: { minVariantPrice: { amount: "14.00", currencyCode: "USD" } },
  },
};

const COLLECTIONS: Record<string, { id: string; handle: string; title: string }> = {
  all: { id: "gid://shopify/Collection/all", handle: "all", title: "All Products" },
};

// `views` increments on every product fetch, so a client refetch shows a new value —
// proof the round-trip happened and the cache updated reactively.
let viewCount = 0;
const rootValue = {
  product: ({ handle }: { handle: string }) => {
    const p = PRODUCTS[handle];
    return p ? { ...p, views: ++viewCount } : null;
  },
  // The write side. `setProductTitle` renames a product in the in-memory store and
  // returns the updated entity (with `id`), so the client's normalized cache folds
  // the new title in place — every read of that product reflects it without a reload.
  setProductTitle: ({ id, title }: { id: string; title: string }) => {
    const product = Object.values(PRODUCTS).find((p) => p.id === id);
    if (!product) return null;
    product.title = title;
    return { ...product, views: ++viewCount };
  },
  collection: ({ handle }: { handle: string }) => {
    const c = COLLECTIONS[handle];
    if (!c) return null;
    return {
      ...c,
      // Cursor pagination: `after` is the previous page's `endCursor` (a product id).
      // The client supplies it via `usePaginated`'s fetchMore; the server just slices.
      products: ({ first, after }: { first: number; after?: string | null }) => {
        const all = Object.values(PRODUCTS);
        const start = after ? all.findIndex((p) => p.id === after) + 1 : 0;
        const slice = all.slice(start, start + first);
        const last = slice[slice.length - 1];
        return {
          nodes: slice.map((p) => ({ ...p, views: ++viewCount })),
          pageInfo: {
            hasNextPage: start + first < all.length,
            endCursor: last ? String(last.id) : null,
          },
        };
      },
    };
  },
};

/** Run a GraphQL document against the in-memory schema (used by the `/graphql` route). */
export async function executeGraphQL(query: string, variables?: Record<string, unknown>) {
  const res = await graphql({ schema, source: query, variableValues: variables, rootValue });
  return { data: res.data ?? undefined, errors: res.errors?.map((e) => ({ message: e.message })) };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/**
 * The `productChanged` subscription as an async stream of GraphResults — a tiny
 * stand-in for a real event source. It "ticks" the product's price every ~1.5s so a
 * client sees live pushes land in the normalized cache. The example serves this over
 * Server-Sent Events; a real app would drive it from a WebSocket / pub-sub instead.
 */
export async function* subscribeProductChanged(
  handle: string,
  signal?: AbortSignal,
): AsyncGenerator<{ data?: Record<string, unknown>; errors?: { message: string }[] }> {
  const product = PRODUCTS[handle];
  if (!product) {
    yield { errors: [{ message: `No product for handle "${handle}"` }] };
    return;
  }
  let amount = Number((product.priceRange as { minVariantPrice: { amount: string } }).minVariantPrice.amount);
  while (!signal?.aborted) {
    await delay(1500, signal);
    if (signal?.aborted) return;
    amount = Number((amount + 0.25).toFixed(2)); // a visible, deterministic tick
    yield {
      data: {
        productChanged: {
          __typename: "Product",
          id: product.id,
          priceRange: {
            __typename: "ProductPriceRange",
            minVariantPrice: { __typename: "MoneyV2", amount: String(amount), currencyCode: "USD" },
          },
        },
      },
    };
  }
}

/** The `GraphClientAdapter` the examples hand to the runtime (SSR preload + client refetch). */
export function makeGraphAdapter(): GraphClientAdapter {
  return {
    async execute(operation, variables) {
      return executeGraphQL(operation.document, variables as Record<string, unknown>) as never;
    },
  };
}
