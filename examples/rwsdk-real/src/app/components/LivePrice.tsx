"use client";
import { useGlean, useSubscription } from "@gleanql/client/client";

/**
 * A live subscription island — zero graph glue. `useSubscription((s, vars) => …)`
 * compiles to a `kind:"subscription"` operation (the selector never runs); the build
 * binds this call to it. The hook opens a Server-Sent Events stream and folds each
 * pushed Product into the normalized cache, so the price below — read through
 * `useGlean()` — ticks up live, no reload and no polling. The push reuses the same
 * record the page hydrated, so it updates in place; fine-grained reactivity re-renders
 * only the components that read it.
 */
export function LivePrice({ handle, initialAmount }: { handle: string; initialAmount: string }) {
  const glean = useGlean();
  const amount = glean?.product({ handle })?.priceRange?.minVariantPrice?.amount ?? initialAmount;

  const { error } = useSubscription(
    (s, vars) => s.productChanged(vars).priceRange.minVariantPrice.amount,
    { variables: { handle } },
  );

  return (
    <p>
      <strong data-test="live-price">live price: {amount} USD</strong>
      {error ? <span style={{ color: "crimson" }}> {error}</span> : <span style={{ color: "#888" }}> (streaming…)</span>}
    </p>
  );
}
