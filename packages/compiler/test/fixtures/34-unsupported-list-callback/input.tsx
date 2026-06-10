import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

// A dynamically-selected callback can't be analyzed. The compiler must SAY so — an
// `unsupported-list-flow` diagnostic — because staying silent would compile an
// operation that UNDER-FETCHES the callback's element reads.
const renderers: Record<string, (p: Product) => unknown> = {};

export default function ListRoute({ params }: { params: { handle: string; kind: string } }) {
  const products = glean.collection({ handle: params.handle }).products({ first: 10 }).nodes;
  return <ul>{products.map(renderers[params.kind])}</ul>;
}
