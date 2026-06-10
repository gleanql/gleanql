import type { Product } from "@gleanql/client/schema";

export function BuyBox({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  return (
    <button type="button">
      Buy — {price.amount}
    </button>
  );
}
