/** @jsx h */
import { h } from "./jsx-runtime.js";
import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

/**
 * Ordinary component code — no GraphQL, no fragments, no selectors. The compiler
 * infers the operation from these reads; at runtime the same reads execute
 * against the request-scoped cache. This file is both compiled and *rendered*.
 */
export function ProductPage({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main>
      <ProductHero product={product} />
      <BuyBox product={product} />
    </main>
  );
}

function ProductHero({ product }: { product: Product }) {
  return (
    <section>
      <h1>{product.title}</h1>
      <img src={product.featuredImage?.url} alt={product.featuredImage?.altText} />
    </section>
  );
}

function BuyBox({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  return (
    <button>
      {price.amount} {price.currencyCode} · views {product.views}
    </button>
  );
}
