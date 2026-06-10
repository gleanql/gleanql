import { glean } from "~/graph";
import { renderRow } from "./render-row.js";

// `.map(renderRow)` — a function REFERENCE (imported), not an inline callback. The
// callback resolves like a helper: the element binds to its first parameter, its
// reads fold into the operation, and the read-map attributes them to the function's
// own name (so `refresh()` can target it like any component).
export default function ListRoute({ params }: { params: { handle: string } }) {
  const products = glean.collection({ handle: params.handle }).products({ first: 10 }).nodes;
  return <ul>{products.map(renderRow)}</ul>;
}
