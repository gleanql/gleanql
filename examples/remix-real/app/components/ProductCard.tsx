import type { Product } from "@gleanql/client/schema";

// A reusable card, in its own file. Used by the collection page; its reads flow
// into the collection route's operation.
export function ProductCard({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  return (
    <a href={`/products/${product.handle}`} style={{ display: "block", margin: "0.5rem 0" }}>
      <strong>{product.title}</strong>{" "}
      <span>
        {price.amount} {price.currencyCode}
      </span>
    </a>
  );
}
