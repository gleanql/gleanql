import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

// A TS-only non-null assertion on a root argument must NOT leak into the emitted
// JS variables factory (`handle!` is invalid JS) — it's stripped to `ctx.params.handle`.
export default function ProductRoute({ params }: { params: { handle?: string } }) {
  const product = glean.product({ handle: params.handle! });
  return <ProductHero product={product} />;
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}
