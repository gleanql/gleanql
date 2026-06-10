import { glean } from "~/graph";

// A `.map` with a BLOCK body that binds an intermediate (`const price = …`) and reads
// off it. The block must be walked (not just scanned) so the binding is tracked and
// `price.amount` / `price.currencyCode` fold into the operation.
export default function ListRoute({ params }: { params: { handle: string } }) {
  const collection = glean.collection({ handle: params.handle });
  return (
    <ul>
      {collection.products({ first: 10 }).nodes.map((product) => {
        const price = product.priceRange.minVariantPrice;
        return (
          <li key={product.id}>
            {product.title} — {price.amount} {price.currencyCode}
          </li>
        );
      })}
    </ul>
  );
}
