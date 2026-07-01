import { glean } from "~/graph";

async function resolveHandle(): Promise<string> {
  return "advent";
}

// async component, but the deferred read is AWAITED → no diagnostic.
export default async function () {
  const handle = await resolveHandle();
  const p = await glean.product({ handle });
  if (!p) return null;
  return p.title;
}
