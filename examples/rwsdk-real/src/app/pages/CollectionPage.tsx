import { glean } from "@gleanql/client";
import { ProductsList } from "@/app/components/ProductsList";
import { ViewsReport } from "@/app/components/ViewsReport";

// List route. The page opens the `collection` root (title + the discovery signal);
// the paginated list lives in the `ProductsList` client island, whose connection
// reads (including the cursor `pageInfo` it chooses to read) fold into this page's
// single operation. `usePaginated` then grows the list with no extra query plumbing.
export function CollectionPage({ params }: { params: { handle: string } }) {
  const collection = glean.collection({ handle: params.handle });
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "2rem auto" }}>
      <h1>{collection.title}</h1>
      <ProductsList handle={params.handle} />
      <ViewsReport handle={params.handle} />
    </main>
  );
}
