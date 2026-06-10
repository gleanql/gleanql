import { glean } from "~/graph";
import type { Product } from "~/graph/schema";
import { Views } from "./Views.js";

// A route renders an island (in another file) that opens its OWN graph root via
// `useGraph()`. The island's reads must fold into the route operation + read-map,
// so the page fetches them and a per-component refetch can target them.
export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main>
      <ProductHero product={product} />
      <Views handle={params.handle} />
    </main>
  );
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}
