import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductSummary product={product} />;
}

function ProductSummary({ product }: { product: Product }) {
  // `title` and `descriptionHtml` are read ONLY inside an array literal that is
  // the receiver of a `.filter().join()` chain. A non-graph call discards its
  // receiver's graph value, so without walking the receiver these reads would
  // silently never reach the operation.
  const summary = [product.title, product.descriptionHtml].filter(Boolean).join(" — ");
  return <h1>{summary}</h1>;
}
