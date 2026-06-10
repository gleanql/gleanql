"use client";
import { useGlean, usePaginated } from "@gleanql/client/client";

/**
 * A client island that renders the paginated list. It reads the `products`
 * connection off the hydrated graph via `useGlean()` (so it re-renders as pages
 * land), and `usePaginated(products)` gives a `fetchMore`. Glean assumes no
 * pagination convention: this component reads `pageInfo.hasNextPage`/`endCursor`
 * itself — that's what puts them in the compiled operation — and passes the cursor
 * to `fetchMore` however the schema wants it (`{ first, after }` here). The compiler
 * folds these reads into the CollectionPage operation, so the first page is
 * preloaded + hydrated and `fetchMore` just concats the next.
 *
 * The card markup is inlined (rather than an imported `<ProductCard>`): a client
 * island's reads fold field-by-field, but the compiler doesn't yet follow an
 * imported component through `.map` inside an island, so those fields are read here.
 */
export function ProductsList({ handle }: { handle: string }) {
  const glean = useGlean();
  const collection = glean?.collection({ handle });
  const products = collection?.products({ first: 2 });
  const { fetchMore, isLoading } = usePaginated(products);
  if (!products) return null; // server flight / pre-hydration

  return (
    <div>
      {products.nodes.map((product) => (
        <a key={product.id} href={`/products/${product.handle}`} style={{ display: "block", margin: "0.5rem 0" }}>
          <strong>{product.title}</strong>{" "}
          <span>
            {product.priceRange.minVariantPrice.amount} {product.priceRange.minVariantPrice.currencyCode}
          </span>
        </a>
      ))}
      {products.pageInfo.hasNextPage && (
        <button
          type="button"
          disabled={isLoading}
          onClick={() => fetchMore({ first: 2, after: products.pageInfo.endCursor })}
          style={{ marginTop: "1rem" }}
        >
          {isLoading ? "loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
