import type { Product } from "~/graph/schema";

// A component nested a directory deeper, to prove resolution follows imports
// across the module graph regardless of location.
export function BuyBox({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  return (
    <button>
      {price.amount} {price.currencyCode}
    </button>
  );
}
