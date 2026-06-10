import type { Product } from "@gleanql/client/schema";

export function ProductHero({ product }: { product: Product }) {
  return (
    <section>
      <h1>{product.title}</h1>
      {product.featuredImage ? (
        <img src={product.featuredImage.url} alt={product.featuredImage.altText ?? ""} width={320} />
      ) : null}
      <div dangerouslySetInnerHTML={{ __html: product.descriptionHtml }} />
    </section>
  );
}
