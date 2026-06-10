import { glean } from "~/graph";

// The root call is mid-chain (`glean.product({...}).title`), not a bare
// `const product = glean.product(...)` — so the field read attaches to the root the
// call opens. This is the form a `useGlean()` island naturally writes
// (`glean.board().todos`); it must compile the same as the split form.
export default function ChainedRoute({ params }: { params: { handle: string } }) {
  const title = glean.product({ handle: params.handle }).title;
  const price = glean.product({ handle: params.handle }).priceRange.minVariantPrice.amount;
  return (
    <main>
      <h1>{title}</h1>
      <span>{price}</span>
    </main>
  );
}
