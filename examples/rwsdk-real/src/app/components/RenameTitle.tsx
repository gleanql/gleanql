"use client";
import { useGlean, useMutation } from "@gleanql/client/client";

/**
 * The write side, as a client island — zero graph glue. `useMutation((m, vars) => …)`
 * compiles to a `kind:"mutation"` operation at build time (the selector never runs);
 * the build binds this call to that operation. Calling `rename({ id, title })` runs it,
 * folds the returned Product into the normalized cache, and — because this island reads
 * the same `product.title` through `useGlean()` — the heading below updates in place,
 * no reload. `isLoading`/`error` come straight off the hook's state.
 */
export function RenameTitle({ handle, id, initialTitle }: { handle: string; id: string; initialTitle: string }) {
  const glean = useGlean();
  const product = glean?.product({ handle });
  const title = product?.title ?? initialTitle;

  const [rename, { isLoading, error }] = useMutation(
    (m, vars: { id: string; title: string }) => m.setProductTitle(vars).title,
  );

  return (
    <p>
      <strong data-test="mutated-title">title: {title}</strong>{" "}
      <button
        type="button"
        disabled={isLoading}
        onClick={() => rename({ id, title: "⚡ Renamed" })}
      >
        {isLoading ? "saving…" : "Rename (mutation)"}
      </button>
      {error ? <span style={{ color: "crimson" }}> {error}</span> : null}
    </p>
  );
}
