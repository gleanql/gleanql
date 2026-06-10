import type { Product } from "~/graph/schema";

export function ProductDebug({ product }: { product: Product }) {
  const copy = { ...product };
  return <pre>{JSON.stringify(copy)}</pre>;
}
