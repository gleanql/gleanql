import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <>
      <ProductHero product={product} />
      <BuyBox product={product} />
    </>
  );
}

function ProductHero({ product }: { product: Product }) {
  return (
    <>
      <h1>{product.title}</h1>
      <img src={product.featuredImage?.url} />
    </>
  );
}

function BuyBox({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  return (
    <button>
      {price.amount} {price.currencyCode}
    </button>
  );
}
