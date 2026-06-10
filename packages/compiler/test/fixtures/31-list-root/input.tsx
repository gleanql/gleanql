import { glean } from "~/graph";

// A top-level LIST root: `glean.products()` resolves to an array directly (no object
// wrapper), so `.map` iterates it and the element reads fold into the operation.
export default function AllProducts() {
  return (
    <ul>
      {glean.products().map((product) => (
        <li key={product.id}>{product.title}</li>
      ))}
    </ul>
  );
}
