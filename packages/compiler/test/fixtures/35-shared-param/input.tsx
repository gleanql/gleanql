import { glean } from "~/graph";
import type { Product, Collection } from "~/graph/schema";

// The SAME route param feeds two different roots. Both root args are "simple"
// context paths named `handle`, so they must lift to ONE `$handle` variable
// (deduped definition + a single factory entry), not two.
export default function Route({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  const collection = glean.collection({ handle: params.handle });
  return (
    <>
      <ProductHero product={product} />
      <CollectionTitle collection={collection} />
    </>
  );
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}

function CollectionTitle({ collection }: { collection: Collection }) {
  return <h2>{collection.title}</h2>;
}
