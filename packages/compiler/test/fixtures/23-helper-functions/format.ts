import type { Product } from "~/graph/schema";

// A helper in another module, taking a destructured graph parameter. Its reads
// must flow into the operation of whatever route calls it.
export function describeImage({ featuredImage }: Product): string {
  return featuredImage?.url ?? "no image";
}
