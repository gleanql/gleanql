import { Row } from "./Row.js";

// An island: it opens its own root via `useGlean()` and renders an imported `Row`
// component for each connection node. `product={p}` forwards the element graph value
// into `Row`, whose reads must fold into the owning route's operation.
declare function useGlean(): typeof import("~/graph").glean | undefined;

export function ProductsList({ handle }: { handle: string }) {
  const g = useGlean();
  const products = g?.collection({ handle }).products({ first: 10 });
  return <ul>{products?.nodes.map((p) => <Row key={p.id} product={p} />)}</ul>;
}
