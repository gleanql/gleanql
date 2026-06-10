import { glean } from "~/graph";
import type { Collection, Product } from "~/graph/schema";

export default function Route({ params }: { params: { handle: string } }) {
  const collection = glean.collection({ handle: params.handle });
  return <ProductList collection={collection} />;
}

function ProductList({ collection }: { collection: Collection }) {
  const first = collection.products({ first: 12 }).nodes;
  const more = collection.products({ first: 24 }).nodes;
  return (
    <>
      {first.map((product) => (
        <ProductCard product={product} />
      ))}
      {more.map((product) => (
        <ProductCard product={product} />
      ))}
    </>
  );
}

function ProductCard({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}
