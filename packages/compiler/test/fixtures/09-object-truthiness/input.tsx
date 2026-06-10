import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductImageBadge product={product} />;
}

function ProductImageBadge({ product }: { product: Product }) {
  if (!product.featuredImage) {
    return null;
  }
  return <span>Has image</span>;
}
