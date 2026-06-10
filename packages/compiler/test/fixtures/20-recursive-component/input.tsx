import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <Tree product={product} />;
}

function Tree({ product }: { product: Product }) {
  return (
    <>
      <h1>{product.title}</h1>
      <Tree product={product} />
    </>
  );
}
