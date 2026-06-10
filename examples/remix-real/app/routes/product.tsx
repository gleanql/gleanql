import { glean } from "@gleanql/client";
import { ProductHero } from "~/components/ProductHero";
import { BuyBox } from "~/components/BuyBox";
import { RefreshViews } from "~/components/RefreshViews";

// Detail route. An ordinary isomorphic component: it reads `glean.product(...)`
// directly (no loader, no props threading) and the same code renders on the server
// (SSR, warm from the request's cache) and the client (hydrated + on navigation).
// The compiler discovers this file (it opens the `product` root) and compiles it
// into the `Product` operation; the component name IS the operation name.
export default function Product({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "2rem auto" }}>
      <p>
        <a href="/collections/all">← Back to all products</a>
      </p>
      <ProductHero product={product} />
      <BuyBox product={product} />
      <p style={{ color: "#666" }}>server-rendered views: {product.views} (static)</p>
      <RefreshViews handle={params.handle} />
    </main>
  );
}
