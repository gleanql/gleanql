import { glean } from "~/graph";

// An anonymous handler reached through `export default` — the shape a webhook
// (or proxy / job) writes: `webhook("topic", () => …)`. It has no binding, so
// its operation is named after the source file: orders.create.tsx → OrdersCreate.
function webhook<T>(_topic: string, handler: T): T {
  return handler;
}

export default webhook("orders/create", () => {
  const product = glean.product({ handle: "advent" });
  return product.title;
});
