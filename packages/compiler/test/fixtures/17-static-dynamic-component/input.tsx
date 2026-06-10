import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductRenderer product={product} variant="card" />;
}

function ProductRenderer({
  product,
  variant,
}: {
  product: Product;
  variant: "card" | "row";
}) {
  const Component = variant === "card" ? ProductCard : ProductRow;
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
