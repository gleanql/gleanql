// A deferred ("two-sweep") root read SYNCHRONOUSLY inside an `async` component
// loops on Suspense in production (the thrown promise re-invokes the async
// component → CPU-limit). The compiler flags it — `unawaited-deferred-read` — and
// the fix is to `await` the read (see 38-await-root). The operation still compiles.
import { glean } from "~/graph";

async function loadId(): Promise<string> {
  return "gid://cart/1";
}

export default async function Route() {
  const id = await loadId();
  const cart = glean.cart({ id }); // sync deferred read in an async component
  if (!cart) return null;
  return cart.totalQuantity;
}
