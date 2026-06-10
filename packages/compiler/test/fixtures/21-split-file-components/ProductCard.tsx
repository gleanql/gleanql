import type { Product } from "~/graph/schema";

// A component in its own file. Its reads must flow into the route's operation.
export function ProductCard({ product }: { product: Product }) {
  return (
    <div>
      <h2>{product.title}</h2>
      <img src={product.featuredImage?.url} />
    </div>
  );
}
