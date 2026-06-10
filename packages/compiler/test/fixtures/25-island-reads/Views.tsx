// An island: it gets the graph from `useGlean()` (opaque to the compiler) and opens
// its own root. The accessor is bound to ANY name (`g`, not `graph`) — the analyzer
// tracks the `useGlean()` binding — so its read folds into the owning route's op.
declare function useGlean(): typeof import("~/graph").glean | undefined;

export function Views({ handle }: { handle: string }) {
  const g = useGlean();
  const product = g?.product({ handle });
  return <span>{product?.availableForSale}</span>;
}
