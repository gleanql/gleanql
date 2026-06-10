import { useCallback, useState } from "react";
import { useGlean, refresh } from "@gleanql/client/client";

/**
 * A client-interactive island — but in React Router (non-RSC) it's an ordinary
 * isomorphic component, no `"use client"`. `useGlean()` returns the SHARED graph
 * (server: the request's runtime via the root middleware's scope; client: the
 * runtime hydrated in `root.tsx`), and re-renders this component when the cache
 * changes. The compiler sees it read `product.views` and folds that into the page
 * operation + read-map, so `refresh()` refetches exactly that.
 */
export function RefreshViews({ handle }: { handle: string }) {
  const product = useGlean().product({ handle }); // isomorphic: the graph is always present
  const views = product.views;
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
