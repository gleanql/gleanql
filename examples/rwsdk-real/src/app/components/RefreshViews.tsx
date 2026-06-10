"use client";
import { useCallback, useState } from "react";
import { useGlean, refresh } from "@gleanql/client/client";

/**
 * A client island inside the RSC page — zero graph glue. `useGlean()` returns the
 * hydrated client graph (and re-renders this component when the cache changes).
 * The compiler sees this island read `product.views` (it opens its own root via
 * `useGlean()`), folds that into the page operation, and records it in the read-map
 * — so `refresh()` refetches exactly `product.views`. On the server / first client
 * render it falls back to the value passed down from the RSC parent.
 */
export function RefreshViews({ handle, initialViews }: { handle: string; initialViews: number }) {
  const glean = useGlean();
  const product = glean?.product({ handle });
  const views = product?.views ?? initialViews;
  const [pending, setPending] = useState(false);

  // refresh() refetches only what THIS component reads (its compiled read-map —
  // here, product.views), pruned over the wire. No hand-written field list: the
  // build binds the call to this component.
  const onRefresh = useCallback(async () => {
    setPending(true);
    try {
      await refresh();
    } finally {
      setPending(false);
    }
  }, []);

  return (
    <p>
      <strong>live views: {views}</strong>{" "}
      <button type="button" onClick={onRefresh} disabled={pending}>
        {pending ? "refreshing…" : "Refresh (client refetch)"}
      </button>
    </p>
  );
}
