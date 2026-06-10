import { glean } from "~/graph";
import type { Product } from "~/graph/schema";
import { describeImage } from "./format.js";

// A local helper taking the whole graph value: its field reads must be tracked
// even though they happen inside a plain function, not a component.
function summary(p: Product): string {
  return `${p.title} — ${p.descriptionHtml}`;
}

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main>
      <p>{summary(product)}</p>
      <figcaption>{describeImage(product)}</figcaption>
    </main>
  );
}
