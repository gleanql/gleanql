import { Fragment } from "react";
import { DocsLayout } from "../layout";

type Pill = { label: string; variant: "solid" | "gray" | "warn" };
type Section = { label: string; code: string };
type GoldenCase = { title: string; slug: string; pills: Pill[]; sections: Section[] };

const CASES: GoldenCase[] = [
  {
    title: "Acceptance",
    slug: "acceptance",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <>
      <ProductHero product={product} />
      <BuyBox product={product} />
    </>
  );
}

function ProductHero({ product }: { product: Product }) {
  return (
    <>
      <h1>{product.title}</h1>
      <img src={product.featuredImage?.url} />
    </>
  );
}

function BuyBox({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  return (
    <button>
      {price.amount} {price.currencyCode}
    </button>
  );
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
    featuredImage {
      __typename
      url
    }
    priceRange {
      __typename
      minVariantPrice {
        __typename
        amount
        currencyCode
      }
    }
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductHero": [
    "Product.title",
    "Product.featuredImage.url"
  ],
  "BuyBox": [
    "Product.priceRange.minVariantPrice.amount",
    "Product.priceRange.minVariantPrice.currencyCode"
  ]
}`,
      },
    ],
  },
  {
    title: "Basic Root",
    slug: "01-basic-root",
    pills: [{ label: "operation", variant: "solid" }, { label: "variables", variant: "gray" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductHero product={product} />;
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
  }
}`,
      },
      {
        label: "Variables factory",
        code: `export function getProductRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductHero": [
    "Product.title"
  ]
}`,
      },
    ],
  },
  {
    title: "Deduped",
    slug: "02-deduped",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <>
      <ProductHero product={product} />
      <Breadcrumb product={product} />
    </>
  );
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}

function Breadcrumb({ product }: { product: Product }) {
  return <span>{product.title}</span>;
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductHero": [
    "Product.title"
  ],
  "Breadcrumb": [
    "Product.title"
  ]
}`,
      },
    ],
  },
  {
    title: "Nested Merge",
    slug: "03-nested-merge",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductHero product={product} />;
}

function ProductHero({ product }: { product: Product }) {
  return (
    <>
      <img src={product.featuredImage?.url} />
      <span>{product.featuredImage?.altText}</span>
    </>
  );
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    featuredImage {
      __typename
      url
      altText
    }
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductHero": [
    "Product.featuredImage.url",
    "Product.featuredImage.altText"
  ]
}`,
      },
    ],
  },
  {
    title: "Alias Tracking",
    slug: "04-alias-tracking",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <BuyBox product={product} />;
}

function BuyBox({ product }: { product: Product }) {
  const price = product.priceRange.minVariantPrice;
  return (
    <button>
      {price.amount} {price.currencyCode}
    </button>
  );
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    priceRange {
      __typename
      minVariantPrice {
        __typename
        amount
        currencyCode
      }
    }
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "BuyBox": [
    "Product.priceRange.minVariantPrice.amount",
    "Product.priceRange.minVariantPrice.currencyCode"
  ]
}`,
      },
    ],
  },
  {
    title: "Destructuring",
    slug: "05-destructuring",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductHero product={product} />;
}

function ProductHero({ product }: { product: Product }) {
  const { title, featuredImage } = product;
  return (
    <>
      <h1>{title}</h1>
      <img src={featuredImage?.url} />
    </>
  );
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
    featuredImage {
      __typename
      url
    }
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductHero": [
    "Product.title",
    "Product.featuredImage.url"
  ]
}`,
      },
    ],
  },
  {
    title: "Multiple Roots",
    slug: "06-multiple-roots",
    pills: [{ label: "operation", variant: "solid" }, { label: "variables", variant: "gray" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product, Cart } from "~/graph/schema";

export default function Route({ params }: { params: { handle: string; cartId: string } }) {
  const product = glean.product({ handle: params.handle });
  const cart = glean.cart({ id: params.cartId });
  return (
    <>
      <ProductHero product={product} />
      <CartSummary cart={cart} />
    </>
  );
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}

function CartSummary({ cart }: { cart: Cart }) {
  return <span>{cart.totalQuantity}</span>;
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query Route($handle: String!, $id: ID!) {
  product(handle: $handle) {
    __typename
    id
    title
  }
  cart(id: $id) {
    __typename
    id
    totalQuantity
  }
}`,
      },
      {
        label: "Variables factory",
        code: `export function getRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
    id: ctx.params.cartId,
  };
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductHero": [
    "Product.title"
  ],
  "CartSummary": [
    "Cart.totalQuantity"
  ]
}`,
      },
    ],
  },
  {
    title: "Callable Args",
    slug: "07-callable-args",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Collection, Product } from "~/graph/schema";

export default function Route({ params }: { params: { handle: string } }) {
  const collection = glean.collection({ handle: params.handle });
  return <ProductList collection={collection} />;
}

function ProductList({ collection }: { collection: Collection }) {
  return collection.products({ first: 12 }).nodes.map((product) => (
    <ProductCard product={product} />
  ));
}

function ProductCard({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query Route($handle: String!) {
  collection(handle: $handle) {
    __typename
    id
    products(first: 12) {
      __typename
      nodes {
        __typename
        id
        title
      }
    }
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductCard": [
    "Product.title"
  ]
}`,
      },
    ],
  },
  {
    title: "Conflicting Args",
    slug: "08-conflicting-args",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Collection, Product } from "~/graph/schema";

export default function Route({ params }: { params: { handle: string } }) {
  const collection = glean.collection({ handle: params.handle });
  return <ProductList collection={collection} />;
}

function ProductList({ collection }: { collection: Collection }) {
  const first = collection.products({ first: 12 }).nodes;
  const more = collection.products({ first: 24 }).nodes;
  return (
    <>
      {first.map((product) => (
        <ProductCard product={product} />
      ))}
      {more.map((product) => (
        <ProductCard product={product} />
      ))}
    </>
  );
}

function ProductCard({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query Route($handle: String!) {
  collection(handle: $handle) {
    __typename
    id
    products_first12: products(first: 12) {
      __typename
      nodes {
        __typename
        id
        title
      }
    }
    products_first24: products(first: 24) {
      __typename
      nodes {
        __typename
        id
        title
      }
    }
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductCard": [
    "Product.title"
  ]
}`,
      },
    ],
  },
  {
    title: "Object Truthiness",
    slug: "09-object-truthiness",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductImageBadge product={product} />;
}

function ProductImageBadge({ product }: { product: Product }) {
  if (!product.featuredImage) {
    return null;
  }
  return <span>Has image</span>;
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    featuredImage {
      __typename
    }
  }
}`,
      },
      {
        label: "Read map",
        code: `{}`,
      },
    ],
  },
  {
    title: "Union Narrowing",
    slug: "10-union-narrowing",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
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
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query Route($query: String!) {
  search(query: $query) {
    __typename
    nodes {
      __typename
      ... on Product {
        __typename
        id
        title
        featuredImage {
          __typename
          url
        }
      }
      ... on Collection {
        __typename
        id
        title
        image {
          __typename
          url
        }
      }
    }
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductCard": [
    "Product.title",
    "Product.featuredImage.url"
  ],
  "CollectionCard": [
    "Collection.title",
    "Collection.image.url"
  ]
}`,
      },
    ],
  },
  {
    title: "Dynamic Field Access",
    slug: "11-dynamic-field-access",
    pills: [{ label: "diagnostic", variant: "warn" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import type { Product } from "~/graph/schema";

export function ProductDebug({ product, fieldName }: { product: Product; fieldName: string }) {
  return <pre>{product[fieldName]}</pre>;
}`,
      },
      {
        label: "Diagnostics",
        code: `[dynamic-field-access]
Cannot compile dynamic graph field access product[fieldName].
Graph fields must be accessed with static property names.`,
      },
    ],
  },
  {
    title: "Unknown Dynamic Component",
    slug: "12-unknown-dynamic-component",
    pills: [{ label: "diagnostic", variant: "warn" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import type { Product } from "~/graph/schema";

export function ProductRenderer({
  product,
  Component,
}: {
  product: Product;
  Component: (props: { product: Product }) => unknown;
}) {
  return <Component product={product} />;
}`,
      },
      {
        label: "Diagnostics",
        code: `[unresolved-dynamic-component]
Cannot statically resolve graph-backed JSX component <Component />.

The component receives graph-backed props:
  product: Product

Use a static conditional, a glean.components(...) registry,
or provide explicit candidates.`,
      },
    ],
  },
  {
    title: "Variable Factory",
    slug: "13-variable-factory",
    pills: [{ label: "operation", variant: "solid" }, { label: "variables", variant: "gray" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const handle = params.handle.toLowerCase();
  const product = glean.product({ handle });
  return <ProductHero product={product} />;
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ProductRoute($product_handle: String!) {
  product(handle: $product_handle) {
    __typename
    id
    title
  }
}`,
      },
      {
        label: "Variables factory",
        code: `export function getProductRouteVariables(ctx) {
  const handle = ctx.params.handle.toLowerCase();
  return {
    product_handle: handle,
  };
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductHero": [
    "Product.title"
  ]
}`,
      },
    ],
  },
  {
    title: "List Filter",
    slug: "14-list-filter",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Collection, Product } from "~/graph/schema";

export default function Route({ params }: { params: { handle: string } }) {
  const collection = glean.collection({ handle: params.handle });
  return <ProductList collection={collection} />;
}

function ProductList({ collection }: { collection: Collection }) {
  const products = collection.products({ first: 12 }).nodes;
  return products
    .filter((product) => product.availableForSale)
    .map((product) => <ProductCard product={product} />);
}

function ProductCard({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query Route($handle: String!) {
  collection(handle: $handle) {
    __typename
    id
    products(first: 12) {
      __typename
      nodes {
        __typename
        id
        availableForSale
        title
      }
    }
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductList": [
    "Product.availableForSale"
  ],
  "ProductCard": [
    "Product.title"
  ]
}`,
      },
    ],
  },
  {
    title: "Scalar Method",
    slug: "15-scalar-method",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductTitle product={product} />;
}

function ProductTitle({ product }: { product: Product }) {
  return <h1>{product.title.toUpperCase()}</h1>;
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductTitle": [
    "Product.title"
  ]
}`,
      },
    ],
  },
  {
    title: "Object Spread",
    slug: "16-object-spread",
    pills: [{ label: "diagnostic", variant: "warn" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import type { Product } from "~/graph/schema";

export function ProductDebug({ product }: { product: Product }) {
  const copy = { ...product };
  return <pre>{JSON.stringify(copy)}</pre>;
}`,
      },
      {
        label: "Diagnostics",
        code: `[graph-value-spread]
Cannot spread graph-backed value product.
Graph values must be passed, read, or explicitly converted.`,
      },
    ],
  },
  {
    title: "Static Dynamic Component",
    slug: "17-static-dynamic-component",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductRenderer product={product} variant="card" />;
}

function ProductRenderer({
  product,
  variant,
}: {
  product: Product;
  variant: "card" | "row";
}) {
  const Component = variant === "card" ? ProductCard : ProductRow;
  return <Component product={product} />;
}

function ProductCard({ product }: { product: Product }) {
  return (
    <>
      <h1>{product.title}</h1>
      <img src={product.featuredImage?.url} />
    </>
  );
}

function ProductRow({ product }: { product: Product }) {
  return (
    <span>
      {product.title} {product.priceRange.minVariantPrice.amount}
    </span>
  );
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
    featuredImage {
      __typename
      url
    }
    priceRange {
      __typename
      minVariantPrice {
        __typename
        amount
      }
    }
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductCard": [
    "Product.title",
    "Product.featuredImage.url"
  ],
  "ProductRow": [
    "Product.title",
    "Product.priceRange.minVariantPrice.amount"
  ]
}`,
      },
    ],
  },
  {
    title: "Component Registry",
    slug: "18-component-registry",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

const productViews = glean.components({
  card: ProductCard,
  row: ProductRow,
  hero: ProductHero,
});

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductRenderer product={product} view="card" />;
}

function ProductRenderer({
  product,
  view,
}: {
  product: Product;
  view: keyof typeof productViews;
}) {
  const Component = productViews[view];
  return <Component product={product} />;
}

function ProductCard({ product }: { product: Product }) {
  return (
    <>
      <h1>{product.title}</h1>
      <img src={product.featuredImage?.url} />
    </>
  );
}

function ProductRow({ product }: { product: Product }) {
  return (
    <span>
      {product.title} {product.priceRange.minVariantPrice.amount}
    </span>
  );
}

function ProductHero({ product }: { product: Product }) {
  return (
    <>
      <h1>{product.title}</h1>
      <img src={product.featuredImage?.url} />
    </>
  );
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
    featuredImage {
      __typename
      url
    }
    priceRange {
      __typename
      minVariantPrice {
        __typename
        amount
      }
    }
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductCard": [
    "Product.title",
    "Product.featuredImage.url"
  ],
  "ProductRow": [
    "Product.title",
    "Product.priceRange.minVariantPrice.amount"
  ],
  "ProductHero": [
    "Product.title",
    "Product.featuredImage.url"
  ]
}`,
      },
    ],
  },
  {
    title: "Lazy Boundary",
    slug: "19-lazy-boundary",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean, GraphLazy } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <>
      <ProductHero product={product} />
      <GraphLazy>
        <ProductDescription product={product} />
      </GraphLazy>
    </>
  );
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}

function ProductDescription({ product }: { product: Product }) {
  return <div>{product.descriptionHtml}</div>;
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "ProductHero": [
    "Product.title"
  ]
}`,
      },
    ],
  },
  {
    title: "Recursive Component",
    slug: "20-recursive-component",
    pills: [{ label: "operation", variant: "solid" }, { label: "read map", variant: "gray" }, { label: "diagnostic", variant: "warn" }],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <Tree product={product} />;
}

function Tree({ product }: { product: Product }) {
  return (
    <>
      <h1>{product.title}</h1>
      <Tree product={product} />
    </>
  );
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "Tree": [
    "Product.title"
  ]
}`,
      },
      {
        label: "Diagnostics",
        code: `[recursive-component]
Cannot statically expand recursive graph component <Tree />.
Provide an explicit recursion depth or wrap the recursive subtree in a lazy boundary.`,
      },
    ],
  },
  {
    title: "Map Named Callback",
    slug: "32-map-named-callback",
    pills: [
      { label: "operation", variant: "solid" },
      { label: "variables", variant: "gray" },
      { label: "read map", variant: "gray" },
    ],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import { renderRow } from "./render-row.js";

// \`.map(renderRow)\` — a function REFERENCE (imported), not an inline callback. The
// callback resolves like a helper: the element binds to its first parameter, its
// reads fold into the operation, and the read-map attributes them to the function's
// own name (so \`refresh()\` can target it like any component).
export default function ListRoute({ params }: { params: { handle: string } }) {
  const products = glean.collection({ handle: params.handle }).products({ first: 10 }).nodes;
  return <ul>{products.map(renderRow)}</ul>;
}`,
      },
      {
        label: "Input — render-row.tsx",
        code: `import type { Product } from "~/graph/schema";

export function renderRow(product: Product) {
  return (
    <li>
      {product.title} — {product.priceRange.minVariantPrice.amount}
    </li>
  );
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ListRoute($handle: String!) {
  collection(handle: $handle) {
    __typename
    id
    products(first: 10) {
      __typename
      nodes {
        __typename
        id
        title
        priceRange {
          __typename
          minVariantPrice {
            __typename
            amount
          }
        }
      }
    }
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "renderRow": [
    "Product.title",
    "Product.priceRange.minVariantPrice.amount"
  ]
}`,
      },
    ],
  },
  {
    title: "Map Destructured Param",
    slug: "33-map-destructured-param",
    pills: [
      { label: "operation", variant: "solid" },
      { label: "variables", variant: "gray" },
      { label: "read map", variant: "gray" },
    ],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";

// A DESTRUCTURED \`.map\` element (\`({ title, handle: slug }) => …\`): each bound name
// is a field read off the element, and a renamed binding reads the ORIGINAL field.
export default function ListRoute({ params }: { params: { handle: string } }) {
  const products = glean.collection({ handle: params.handle }).products({ first: 10 }).nodes;
  return (
    <ul>
      {products.map(({ title, handle: slug }) => (
        <li key={slug}>{title}</li>
      ))}
    </ul>
  );
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ListRoute($handle: String!) {
  collection(handle: $handle) {
    __typename
    id
    products(first: 10) {
      __typename
      nodes {
        __typename
        id
        title
        handle
      }
    }
  }
}`,
      },
      {
        label: "Read map",
        code: `{
  "ListRoute": [
    "Product.title",
    "Product.handle"
  ]
}`,
      },
    ],
  },
  {
    title: "Unsupported List Callback",
    slug: "34-unsupported-list-callback",
    pills: [
      { label: "operation", variant: "solid" },
      { label: "diagnostic", variant: "warn" },
    ],
    sections: [
      {
        label: "Input — input.tsx",
        code: `import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

// A dynamically-selected callback can't be analyzed. The compiler must SAY so — an
// \`unsupported-list-flow\` diagnostic — because staying silent would compile an
// operation that UNDER-FETCHES the callback's element reads.
const renderers: Record<string, (p: Product) => unknown> = {};

export default function ListRoute({ params }: { params: { handle: string; kind: string } }) {
  const products = glean.collection({ handle: params.handle }).products({ first: 10 }).nodes;
  return <ul>{products.map(renderers[params.kind])}</ul>;
}`,
      },
      {
        label: "Generated GraphQL",
        code: `query ListRoute($handle: String!) {
  collection(handle: $handle) {
    __typename
    id
    products(first: 10) {
      __typename
      nodes {
        __typename
        id
      }
    }
  }
}`,
      },
      {
        label: "Diagnostics",
        code: `[unsupported-list-flow]
Cannot statically analyze the list callback renderers[params.kind].
Use an inline arrow/function, a reference to a named function, or a destructured
element parameter — the callback's element reads must be statically visible.`,
      },
    ],
  },
];

function GoldenCaseBlock({ c }: { c: GoldenCase }) {
  return (
    <div className="golden-case">
      <div className="gc-head">
        {c.title}{" "}
        <span style={{ color: "#8893a4", fontWeight: 400, fontSize: "13px" }}>· {c.slug}</span>
        {c.pills.map((pill, i) => (
          <Fragment key={i}>
            {" "}
            {pill.variant === "warn" ? (
              <span className="pill" style={{ background: "#fff7e6", color: "#a06a00" }}>{pill.label}</span>
            ) : (
              <span className={pill.variant === "gray" ? "pill gray" : "pill"}>{pill.label}</span>
            )}
          </Fragment>
        ))}
      </div>
      <div className="gc-body">
        {c.sections.map((s, i) => (
          <Fragment key={i}>
            <p className="gc-label">{s.label}</p>
            <pre><code>{s.code}</code></pre>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

export function GoldenCasesPage() {
  return (
    <DocsLayout active="golden-cases.html">
      <title>Golden cases · glean</title>
      <h1>Golden cases</h1>
      <p className="lede">The compiler's behavior catalog. Each fixture is <code>input.tsx</code> plus the expected{" "}
      <code>expected.graphql</code> / <code>expected.variables.ts</code> / <code>expected.readmap.json</code> /{" "}
      <code>expected.diagnostics.json</code>. Every generated operation here is also validated against the real
      schema with graphql-js. This page is generated directly from the fixtures.</p>
      {CASES.map((c) => (
        <GoldenCaseBlock key={c.slug} c={c} />
      ))}
      <footer>24 fixtures shown. Source: <code>packages/compiler/test/fixtures/</code>.</footer>
    </DocsLayout>
  );
}
