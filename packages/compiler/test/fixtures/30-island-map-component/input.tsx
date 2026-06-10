import { glean } from "~/graph";
import { ProductsList } from "./ProductsList.js";

// A route renders an island (`ProductsList`) that maps a connection to an IMPORTED
// component (`Row`, in a third file). The component's reads — reached only through a
// JSX prop inside the island's `.map` — must fold into the route operation. (The JSX
// attribute name lives in the island's file, so it must be read off the identifier,
// not via `getText` against the entry file.)
export default function ListRoute({ params }: { params: { handle: string } }) {
  glean.collection({ handle: params.handle });
  return <ProductsList handle={params.handle} />;
}
