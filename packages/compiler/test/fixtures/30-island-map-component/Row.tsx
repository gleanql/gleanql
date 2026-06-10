import type { Product } from "~/graph/schema";
export function Row({ product }: { product: Product }) {
  return <li>{product.title} — {product.priceRange.minVariantPrice.amount}</li>;
}
