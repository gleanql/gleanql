import { glean } from "~/graph";
import type { Product, Cart } from "~/graph/schema";

export default function Route({ params }: { params: { handle: string; cartId: string } }) {
  const product = glean.product({ handle: params.handle });
  const cart = glean.cart({ id: params.cartId });
  return (
    <>
      <ProductHero product={product} />
      <CartSummary cart={cart} />
    </>
  );
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}

function CartSummary({ cart }: { cart: Cart }) {
  return <span>{cart.totalQuantity}</span>;
}
