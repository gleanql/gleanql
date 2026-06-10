import type { Product } from "~/graph/schema";

export function ProductDebug({ product, fieldName }: { product: Product; fieldName: string }) {
  return <pre>{product[fieldName]}</pre>;
}
