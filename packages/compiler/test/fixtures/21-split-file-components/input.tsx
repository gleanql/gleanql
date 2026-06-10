import { glean } from "~/graph";
import { ProductCard } from "./ProductCard.js";
import { BuyBox } from "./nested/BuyBox.js";

// A route whose components live in other files (one even a directory deeper).
export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main>
      <ProductCard product={product} />
      <BuyBox product={product} />
    </main>
  );
}
