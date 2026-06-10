// Generated-style branded schema types for the example storefront. To app code
// these read as ordinary types; the compiler recognizes them via `__typename`.

export interface Product {
  __typename: "Product";
  id: string;
  handle: string;
  title: string;
  descriptionHtml: string;
  featuredImage: Image | null;
  priceRange: ProductPriceRange;
  views: number;
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
