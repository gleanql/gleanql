import type { Product } from "~/graph/schema";

export function ProductRenderer({
  product,
  Component,
}: {
  product: Product;
  Component: (props: { product: Product }) => unknown;
}) {
  return <Component product={product} />;
}
