import { glean } from "~/graph";
import type { Collection, Product, SearchResultItem } from "~/graph/schema";

export default function Route({ params }: { params: { query: string } }) {
  const results = glean.search({ query: params.query });
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
