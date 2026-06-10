import { glean } from "~/graph";
// Imported through the app's `@/` tsconfig alias rather than a relative path.
import { PriceTag } from "@/components/PriceTag";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main>
      <h1>{product.title}</h1>
      <PriceTag product={product} />
    </main>
  );
}
