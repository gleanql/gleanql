import { glean } from "~/graph";

// daydibs API-route shape: an anonymous default-export handler that `await`s a
// glean ROOT with a render-time argument and reads fields off the awaited value.
// Named after the file (booking.tsx → Booking); the root is deferred (two-sweep)
// and the reads on the awaited binding trace into the operation.
async function resolveHandle(): Promise<string> {
  return "advent";
}

export default async function () {
  const handle = await resolveHandle();
  const product = await glean.product({ handle });
  if (!product) return null;
  return product.title;
}
