import type { Product } from "~/graph/schema";

// Lives under `@/components`; its reads must still flow into the route operation.
export function PriceTag({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  return (
    <span>
      {price.amount} {price.currencyCode}
    </span>
  );
}
