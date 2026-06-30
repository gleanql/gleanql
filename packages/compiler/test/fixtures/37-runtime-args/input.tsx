// Two-sweep: a render-time value (sweep 1) feeds a glean read's argument
// (sweep 2). The arg references an in-render local, so it can't be preloaded from
// ctx — the operation is `deferred` and executes at the call-site. Narrowing via
// `__typename` is unaffected (see 10-union-narrowing).
import { glean } from "~/graph";
import type { Collection, Product, SearchResultItem } from "~/graph/schema";

async function loadQuery(): Promise<string> {
  return "shoes";
}

export default async function Route() {
  const q = await loadQuery(); // sweep 1: render-time value
  const results = glean.search({ query: q }); // sweep 2: glean, runtime arg
  return results.nodes.map((node) => <SearchResult node={node} />);
}

function SearchResult({ node }: { node: SearchResultItem }) {
  if (node.__typename === "Product") {
    return <ProductCard product={node} />;
  }
  if (node.__typename === "Collection") {
    return <CollectionCard collection={node} />;
  }
  return null;
}

function ProductCard({ product }: { product: Product }) {
  return (
    <>
      <h1>{product.title}</h1>
      <img src={product.featuredImage?.url} />
    </>
  );
}

function CollectionCard({ collection }: { collection: Collection }) {
  return (
    <>
      <h1>{collection.title}</h1>
      <img src={collection.image?.url} />
    </>
  );
}
