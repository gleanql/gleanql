import { glean } from "~/graph";

// Anonymous `export default function` — the common proxy-handler shape. Named
// from the file: order-status.tsx → OrderStatus.
export default async function () {
  const products = glean.products();
  return products.map((p) => p.title);
}
