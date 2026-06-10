// Generated-style branded schema types. To userland these look like ordinary
// interfaces; the compiler recognizes them as graph-backed via the literal
// `__typename` (which is genuinely the GraphQL __typename of each object).

export interface Product {
  __typename: "Product";
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  availableForSale: boolean;
  featuredImage: Image | null;
  priceRange: ProductPriceRange;
}

export interface Image {
  __typename: "Image";
  url: string;
  altText: string | null;
}

export interface ProductPriceRange {
  __typename: "ProductPriceRange";
  minVariantPrice: MoneyV2;
}

export interface MoneyV2 {
  __typename: "MoneyV2";
  amount: string;
  currencyCode: string;
}

export interface Cart {
  __typename: "Cart";
  id: string;
  totalQuantity: number;
}

export interface ProductConnection {
  __typename: "ProductConnection";
  nodes: Product[];
}

export interface Collection {
  __typename: "Collection";
  id: string;
  title: string;
  image: Image | null;
  products(args: { first: number }): ProductConnection;
}

export interface SearchResultConnection {
  __typename: "SearchResultConnection";
  nodes: SearchResultItem[];
}

export type SearchResultItem = Product | Collection;
