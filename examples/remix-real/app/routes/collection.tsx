import { glean } from "@gleanql/client";
import { ProductCard } from "~/components/ProductCard";

// List route. A connection root + `.nodes.map(...)` over an imported component;
// the card's reads merge into this route's single operation. Same component reads
// as the rwsdk example, here driving an isomorphic React Router page.
export default function Collection({ params }: { params: { handle: string } }) {
  const collection = glean.collection({ handle: params.handle });
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "2rem auto" }}>
      <h1>{collection.title}</h1>
      <div>
        {collection.products({ first: 12 }).nodes.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </main>
  );
}
