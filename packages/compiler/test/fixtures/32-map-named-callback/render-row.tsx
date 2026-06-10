import type { Product } from "~/graph/schema";

export function renderRow(product: Product) {
  return (
    <li>
      {product.title} — {product.priceRange.minVariantPrice.amount}
    </li>
  );
}
