import { useMutation } from "~/graph";

// A "use client" island uses `useMutation`. The selector roots at the schema's
// Mutation type: `m.setProductTitle(vars)` is the mutation root (its args lift to
// operation variables), and `.title` selects the result — so the returned Product
// normalizes into the cache and updates in place.
export function EditTitle({ id }: { id: string }) {
  const [setTitle, { isLoading }] = useMutation(
    (m, vars: { id: string; title: string }) => m.setProductTitle(vars).title,
  );
  return (
    <button disabled={isLoading} onClick={() => setTitle({ id, title: "New Title" })}>
      Rename
    </button>
  );
}
