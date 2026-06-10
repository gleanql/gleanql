import { graph, GraphLazy } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <>
      <ProductHero product={product} />
      <GraphLazy>
        <ProductDescription product={product} />
      </GraphLazy>
    </>
  );
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}

function ProductDescription({ product }: { product: Product }) {
  return <div>{product.descriptionHtml}</div>;
}
