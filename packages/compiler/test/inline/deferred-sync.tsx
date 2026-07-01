import { glean } from "~/graph";

function makeHandle(): string {
  return "advent";
}

// A NON-async component: a synchronous deferred read is fine (a Suspense boundary
// catches the throw) → no diagnostic.
export default function () {
  const handle = makeHandle();
  const p = glean.product({ handle });
  return <div>{p.title}</div>;
}
