import { useSubscription } from "~/graph";

// A "use client" island subscribes to live product updates. The selector roots at
// the schema's Subscription type: `s.productChanged(vars)` is the operation root
// (its args lift to operation variables), and `.title` selects the result — so each
// pushed Product normalizes into the cache and updates in place.
export function LiveTitle({ handle }: { handle: string }) {
  const { data, error } = useSubscription(
    (s, vars: { handle: string }) => s.productChanged(vars).title,
  );
  return <p>{error ? `error: ${error}` : `live title: ${data ?? "…"}`}</p>;
}
