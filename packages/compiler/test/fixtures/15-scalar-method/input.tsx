import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductTitle product={product} />;
}

function ProductTitle({ product }: { product: Product }) {
  return <h1>{product.title.toUpperCase()}</h1>;
}
