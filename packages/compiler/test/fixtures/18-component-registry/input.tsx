import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

const productViews = glean.components({
  card: ProductCard,
  row: ProductRow,
  hero: ProductHero,
});

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductRenderer product={product} view="card" />;
}

function ProductRenderer({
  product,
  view,
}: {
  product: Product;
  view: keyof typeof productViews;
}) {
  const Component = productViews[view];
  return <Component product={product} />;
}

function ProductCard({ product }: { product: Product }) {
  return (
    <>
      <h1>{product.title}</h1>
      <img src={product.featuredImage?.url} />
    </>
  );
}

function ProductRow({ product }: { product: Product }) {
  return (
    <span>
      {product.title} {product.priceRange.minVariantPrice.amount}
    </span>
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
