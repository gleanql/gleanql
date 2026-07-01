// Awaiting a glean ROOT itself — the non-React server-handler pattern (a webhook,
// job, proxy, or API route can't Suspense, so it `await`s the read). The compiler
// must see through `const cart = await glean.cart({ id })` to bind `cart` to the
// deferred root and trace its field reads (`cart.totalQuantity`), exactly as the
// un-awaited React form does. `id` is a render-time value (sweep 1), so the root is
// deferred and executes at the call-site (sweep 2).
import { glean } from "~/graph";

async function loadId(): Promise<string> {
  return "gid://cart/1";
}

export default async function Route() {
  const id = await loadId();
  const cart = await glean.cart({ id });
  if (!cart) return null;
  return cart.totalQuantity;
}
