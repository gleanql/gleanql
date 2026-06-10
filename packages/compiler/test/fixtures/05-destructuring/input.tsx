import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductHero product={product} />;
}

function ProductHero({ product }: { product: Product }) {
  const { title, featuredImage } = product;
  return (
    <>
      <h1>{title}</h1>
      <img src={featuredImage?.url} />
    </>
  );
}
