import { glean } from "@gleanql/client";

import { ProductHero } from "@/app/components/ProductHero";
import { BuyBox } from "@/app/components/BuyBox";
import { RefreshViews } from "@/app/components/RefreshViews";
import { RenameTitle } from "@/app/components/RenameTitle";
import { LivePrice } from "@/app/components/LivePrice";

// Detail route (RSC). Components live in other files; the compiler follows them
// and merges their reads into one operation. The `product.views` read here puts
// `views` in the operation, so it's seeded server-side and hydrated to the client
// island below — which can then refetch it without a reload.
export function ProductPage({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "2rem auto" }}>
      <p>
        <a href="/collections/all">← Back to all products</a>
      </p>
      <ProductHero product={product} />
      <BuyBox product={product} />
      <p style={{ color: "#666" }}>server-rendered views: {product.views} (static)</p>
      <RefreshViews handle={params.handle} initialViews={product.views} />
      <RenameTitle handle={params.handle} id={product.id} initialTitle={product.title} />
      <LivePrice handle={params.handle} initialAmount={product.priceRange.minVariantPrice.amount} />
    </main>
  );
}
