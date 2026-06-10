---
title: Golden cases
group: Reference
order: 13
---

# Golden cases

The compiler's behavior catalog, generated directly from `packages/compiler/test/fixtures/` — every case below is a real golden fixture: `input.tsx` plus the expected operation, variables factory, read map and diagnostics, asserted byte-for-byte through BOTH type-checker engines and validated against the schema with graphql-js.

> [!NOTE]
> The fixtures import from a `~/graph` test alias — the analyzer recognizes the accessor **by binding, not by module path**, so the harness keeps it framework-neutral. In an app you import from `@gleanql/client` / `@gleanql/client/schema`, as shown in [Get started](get-started.md).

## Basic Root

`01-basic-root`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductHero product={product} />;
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
  }
}
```

**Variables factory**

```ts
export function getProductRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}
```

**Read map**

```json
{
  "ProductHero": [
    "Product.title"
  ]
}
```

## Deduped

`02-deduped`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
  }
}
```

**Read map**

```json
{
  "ProductHero": [
    "Product.title"
  ],
  "Breadcrumb": [
    "Product.title"
  ]
}
```

## Nested Merge

`03-nested-merge`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    featuredImage {
      __typename
      url
      altText
    }
  }
}
```

**Read map**

```json
{
  "ProductHero": [
    "Product.featuredImage.url",
    "Product.featuredImage.altText"
  ]
}
```

## Alias Tracking

`04-alias-tracking`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
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
}
```

**Read map**

```json
{
  "BuyBox": [
    "Product.priceRange.minVariantPrice.amount",
    "Product.priceRange.minVariantPrice.currencyCode"
  ]
}
```

## Destructuring

`05-destructuring`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
    featuredImage {
      __typename
      url
    }
  }
}
```

**Read map**

```json
{
  "ProductHero": [
    "Product.title",
    "Product.featuredImage.url"
  ]
}
```

## Multiple Roots

`06-multiple-roots`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query Route($handle: String!, $id: ID!) {
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
}
```

**Variables factory**

```ts
export function getRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
    id: ctx.params.cartId,
  };
}
```

**Read map**

```json
{
  "ProductHero": [
    "Product.title"
  ],
  "CartSummary": [
    "Cart.totalQuantity"
  ]
}
```

## Callable Args

`07-callable-args`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query Route($handle: String!) {
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
}
```

**Read map**

```json
{
  "ProductCard": [
    "Product.title"
  ]
}
```

## Conflicting Args

`08-conflicting-args`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query Route($handle: String!) {
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
}
```

**Read map**

```json
{
  "ProductCard": [
    "Product.title"
  ]
}
```

## Object Truthiness

`09-object-truthiness`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    featuredImage {
      __typename
    }
  }
}
```

**Read map**

```json
{}
```

## Union Narrowing

`10-union-narrowing`

**Input — input.tsx**

```tsx
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
```

**Generated GraphQL**

```graphql
query Route($query: String!) {
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
}
```

**Read map**

```json
{
  "ProductCard": [
    "Product.title",
    "Product.featuredImage.url"
  ],
  "CollectionCard": [
    "Collection.title",
    "Collection.image.url"
  ]
}
```

## Dynamic Field Access

`11-dynamic-field-access`

**Input — input.tsx**

```tsx
import type { Product } from "~/graph/schema";

export function ProductDebug({ product, fieldName }: { product: Product; fieldName: string }) {
  return <pre>{product[fieldName]}</pre>;
}
```

**Diagnostics**

```text
[dynamic-field-access]
Cannot compile dynamic graph field access product[fieldName].
Graph fields must be accessed with static property names.
```

## Unknown Dynamic Component

`12-unknown-dynamic-component`

**Input — input.tsx**

```tsx
import type { Product } from "~/graph/schema";

export function ProductRenderer({
  product,
  Component,
}: {
  product: Product;
  Component: (props: { product: Product }) => unknown;
}) {
  return <Component product={product} />;
}
```

**Diagnostics**

```text
[unresolved-dynamic-component]
Cannot statically resolve graph-backed JSX component <Component />.

The component receives graph-backed props:
  product: Product

Use a static conditional, a graph.components(...) registry,
or provide explicit candidates.
```

## Variable Factory

`13-variable-factory`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const handle = params.handle.toLowerCase();
  const product = glean.product({ handle });
  return <ProductHero product={product} />;
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}
```

**Generated GraphQL**

```graphql
query ProductRoute($product_handle: String!) {
  product(handle: $product_handle) {
    __typename
    id
    title
  }
}
```

**Variables factory**

```ts
export function getProductRouteVariables(ctx) {
  const handle = ctx.params.handle.toLowerCase();
  return {
    product_handle: handle,
  };
}
```

**Read map**

```json
{
  "ProductHero": [
    "Product.title"
  ]
}
```

## List Filter

`14-list-filter`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query Route($handle: String!) {
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
}
```

**Read map**

```json
{
  "ProductList": [
    "Product.availableForSale"
  ],
  "ProductCard": [
    "Product.title"
  ]
}
```

## Scalar Method

`15-scalar-method`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return <ProductTitle product={product} />;
}

function ProductTitle({ product }: { product: Product }) {
  return <h1>{product.title.toUpperCase()}</h1>;
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
  }
}
```

**Read map**

```json
{
  "ProductTitle": [
    "Product.title"
  ]
}
```

## Object Spread

`16-object-spread`

**Input — input.tsx**

```tsx
import type { Product } from "~/graph/schema";

export function ProductDebug({ product }: { product: Product }) {
  const copy = { ...product };
  return <pre>{JSON.stringify(copy)}</pre>;
}
```

**Diagnostics**

```text
[graph-value-spread]
Cannot spread graph-backed value product.
Graph values must be passed, read, or explicitly converted.
```

## Static Dynamic Component

`17-static-dynamic-component`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
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
}
```

**Read map**

```json
{
  "ProductCard": [
    "Product.title",
    "Product.featuredImage.url"
  ],
  "ProductRow": [
    "Product.title",
    "Product.priceRange.minVariantPrice.amount"
  ]
}
```

## Component Registry

`18-component-registry`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
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
}
```

**Read map**

```json
{
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
}
```

## Lazy Boundary

`19-lazy-boundary`

**Input — input.tsx**

```tsx
import { graph, GraphLazy } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
  }
}
```

**Read map**

```json
{
  "ProductHero": [
    "Product.title"
  ]
}
```

## Recursive Component

`20-recursive-component`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
  }
}
```

**Read map**

```json
{
  "Tree": [
    "Product.title"
  ]
}
```

**Diagnostics**

```text
[recursive-component]
Cannot statically expand recursive graph component <Tree />.
Provide an explicit recursion depth or wrap the recursive subtree in a lazy boundary.
```

## Split File Components

`21-split-file-components`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
import { ProductCard } from "./ProductCard.js";
import { BuyBox } from "./nested/BuyBox.js";

// A route whose components live in other files (one even a directory deeper).
export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main>
      <ProductCard product={product} />
      <BuyBox product={product} />
    </main>
  );
}
```

**Input — ProductCard.tsx**

```tsx
import type { Product } from "~/graph/schema";

// A component in its own file. Its reads must flow into the route's operation.
export function ProductCard({ product }: { product: Product }) {
  return (
    <div>
      <h2>{product.title}</h2>
      <img src={product.featuredImage?.url} />
    </div>
  );
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
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
}
```

**Variables factory**

```ts
export function getProductRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}
```

**Read map**

```json
{
  "ProductCard": [
    "Product.title",
    "Product.featuredImage.url"
  ],
  "BuyBox": [
    "Product.priceRange.minVariantPrice.amount",
    "Product.priceRange.minVariantPrice.currencyCode"
  ]
}
```

## Path Alias

`22-path-alias`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
// Imported through the app's `@/` tsconfig alias rather than a relative path.
import { PriceTag } from "@/components/PriceTag";

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main>
      <h1>{product.title}</h1>
      <PriceTag product={product} />
    </main>
  );
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
    priceRange {
      __typename
      minVariantPrice {
        __typename
        amount
        currencyCode
      }
    }
  }
}
```

**Variables factory**

```ts
export function getProductRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}
```

**Read map**

```json
{
  "ProductRoute": [
    "Product.title"
  ],
  "PriceTag": [
    "Product.priceRange.minVariantPrice.amount",
    "Product.priceRange.minVariantPrice.currencyCode"
  ]
}
```

## Helper Functions

`23-helper-functions`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
import type { Product } from "~/graph/schema";
import { describeImage } from "./format.js";

// A local helper taking the whole graph value: its field reads must be tracked
// even though they happen inside a plain function, not a component.
function summary(p: Product): string {
  return `${p.title} — ${p.descriptionHtml}`;
}

export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main>
      <p>{summary(product)}</p>
      <figcaption>{describeImage(product)}</figcaption>
    </main>
  );
}
```

**Input — format.ts**

```tsx
import type { Product } from "~/graph/schema";

// A helper in another module, taking a destructured graph parameter. Its reads
// must flow into the operation of whatever route calls it.
export function describeImage({ featuredImage }: Product): string {
  return featuredImage?.url ?? "no image";
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
    descriptionHtml
    featuredImage {
      __typename
      url
    }
  }
}
```

**Variables factory**

```ts
export function getProductRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}
```

**Read map**

```json
{
  "summary": [
    "Product.title",
    "Product.descriptionHtml"
  ],
  "describeImage": [
    "Product.featuredImage.url"
  ]
}
```

## Nonnull Arg

`24-nonnull-arg`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

// A TS-only non-null assertion on a root argument must NOT leak into the emitted
// JS variables factory (`handle!` is invalid JS) — it's stripped to `ctx.params.handle`.
export default function ProductRoute({ params }: { params: { handle?: string } }) {
  const product = glean.product({ handle: params.handle! });
  return <ProductHero product={product} />;
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
  }
}
```

**Variables factory**

```ts
export function getProductRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}
```

**Read map**

```json
{
  "ProductHero": [
    "Product.title"
  ]
}
```

## Island Reads

`25-island-reads`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
import type { Product } from "~/graph/schema";
import { Views } from "./Views.js";

// A route renders an island (in another file) that opens its OWN graph root via
// `useGraph()`. The island's reads must fold into the route operation + read-map,
// so the page fetches them and a per-component refetch can target them.
export default function ProductRoute({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main>
      <ProductHero product={product} />
      <Views handle={params.handle} />
    </main>
  );
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}
```

**Input — Views.tsx**

```tsx
// An island: it gets the graph from `useGlean()` (opaque to the compiler) and opens
// its own root. The accessor is bound to ANY name (`g`, not `graph`) — the analyzer
// tracks the `useGlean()` binding — so its read folds into the owning route's op.
declare function useGlean(): typeof import("~/graph").glean | undefined;

export function Views({ handle }: { handle: string }) {
  const g = useGlean();
  const product = g?.product({ handle });
  return <span>{product?.availableForSale}</span>;
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
    availableForSale
  }
}
```

**Variables factory**

```ts
export function getProductRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}
```

**Read map**

```json
{
  "ProductHero": [
    "Product.title"
  ],
  "Views": [
    "Product.availableForSale"
  ]
}
```

## Mutation

`26-mutation`

**Input — input.tsx**

```tsx
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
```

**Generated GraphQL**

```graphql
mutation EditTitle_setProductTitle($id: ID!, $title: String!) {
  setProductTitle(id: $id, title: $title) {
    __typename
    id
    title
  }
}
```

**Variables factory**

```ts
export function getEditTitle_setProductTitleVariables(ctx) {
  return {
    id: ctx.id,
    title: ctx.title,
  };
}
```

**Read map**

```json
{}
```

## Subscription

`27-subscription`

**Input — input.tsx**

```tsx
import { useSubscription } from "~/graph";

// A "use client" island subscribes to live product updates. The selector roots at
// the schema's Subscription type: `s.productChanged(vars)` is the operation root
// (its args lift to operation variables), and `.title` selects the result — so each
// pushed Product normalizes into the cache and updates in place.
export function LiveTitle({ handle }: { handle: string }) {
  const { data, error } = useSubscription(
    (s, vars: { handle: string }) => s.productChanged(vars).title,
  );
  return <p>{error ? `error: ${error}` : `live title: ${data ?? "…"}`}</p>;
}
```

**Generated GraphQL**

```graphql
subscription LiveTitle_productChanged($handle: String!) {
  productChanged(handle: $handle) {
    __typename
    id
    title
  }
}
```

**Variables factory**

```ts
export function getLiveTitle_productChangedVariables(ctx) {
  return {
    handle: ctx.handle,
  };
}
```

**Read map**

```json
{}
```

## Chained Root

`28-chained-root`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";

// The root call is mid-chain (`glean.product({...}).title`), not a bare
// `const product = glean.product(...)` — so the field read attaches to the root the
// call opens. This is the form a `useGlean()` island naturally writes
// (`glean.board().todos`); it must compile the same as the split form.
export default function ChainedRoute({ params }: { params: { handle: string } }) {
  const title = glean.product({ handle: params.handle }).title;
  const price = glean.product({ handle: params.handle }).priceRange.minVariantPrice.amount;
  return (
    <main>
      <h1>{title}</h1>
      <span>{price}</span>
    </main>
  );
}
```

**Generated GraphQL**

```graphql
query ChainedRoute($handle: String!) {
  product(handle: $handle) {
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
```

**Variables factory**

```ts
export function getChainedRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}
```

**Read map**

```json
{
  "ChainedRoute": [
    "Product.title",
    "Product.priceRange.minVariantPrice.amount"
  ]
}
```

## Map Block Binding

`29-map-block-binding`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";

// A `.map` with a BLOCK body that binds an intermediate (`const price = …`) and reads
// off it. The block must be walked (not just scanned) so the binding is tracked and
// `price.amount` / `price.currencyCode` fold into the operation.
export default function ListRoute({ params }: { params: { handle: string } }) {
  const collection = glean.collection({ handle: params.handle });
  return (
    <ul>
      {collection.products({ first: 10 }).nodes.map((product) => {
        const price = product.priceRange.minVariantPrice;
        return (
          <li key={product.id}>
            {product.title} — {price.amount} {price.currencyCode}
          </li>
        );
      })}
    </ul>
  );
}
```

**Generated GraphQL**

```graphql
query ListRoute($handle: String!) {
  collection(handle: $handle) {
    __typename
    id
    products(first: 10) {
      __typename
      nodes {
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
        title
      }
    }
  }
}
```

**Variables factory**

```ts
export function getListRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}
```

## Island Map Component

`30-island-map-component`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
import { ProductsList } from "./ProductsList.js";

// A route renders an island (`ProductsList`) that maps a connection to an IMPORTED
// component (`Row`, in a third file). The component's reads — reached only through a
// JSX prop inside the island's `.map` — must fold into the route operation. (The JSX
// attribute name lives in the island's file, so it must be read off the identifier,
// not via `getText` against the entry file.)
export default function ListRoute({ params }: { params: { handle: string } }) {
  glean.collection({ handle: params.handle });
  return <ProductsList handle={params.handle} />;
}
```

**Input — ProductsList.tsx**

```tsx
import { Row } from "./Row.js";

// An island: it opens its own root via `useGlean()` and renders an imported `Row`
// component for each connection node. `product={p}` forwards the element graph value
// into `Row`, whose reads must fold into the owning route's operation.
declare function useGlean(): typeof import("~/graph").glean | undefined;

export function ProductsList({ handle }: { handle: string }) {
  const g = useGlean();
  const products = g?.collection({ handle }).products({ first: 10 });
  return <ul>{products?.nodes.map((p) => <Row key={p.id} product={p} />)}</ul>;
}
```

**Input — Row.tsx**

```tsx
import type { Product } from "~/graph/schema";
export function Row({ product }: { product: Product }) {
  return <li>{product.title} — {product.priceRange.minVariantPrice.amount}</li>;
}
```

**Generated GraphQL**

```graphql
query ListRoute($handle: String!) {
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
}
```

**Variables factory**

```ts
export function getListRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}
```

**Read map**

```json
{
  "ProductsList": [
    "Product.id"
  ],
  "Row": [
    "Product.title",
    "Product.priceRange.minVariantPrice.amount"
  ]
}
```

## List Root

`31-list-root`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";

// A top-level LIST root: `glean.products()` resolves to an array directly (no object
// wrapper), so `.map` iterates it and the element reads fold into the operation.
export default function AllProducts() {
  return (
    <ul>
      {glean.products().map((product) => (
        <li key={product.id}>{product.title}</li>
      ))}
    </ul>
  );
}
```

**Generated GraphQL**

```graphql
query AllProducts {
  products {
    __typename
    id
    title
  }
}
```

**Variables factory**

```ts
export function getAllProductsVariables(ctx) {
  return {
  };
}
```

**Read map**

```json
{
  "AllProducts": [
    "Product.id",
    "Product.title"
  ]
}
```

## Map Named Callback

`32-map-named-callback`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
import { renderRow } from "./render-row.js";

// `.map(renderRow)` — a function REFERENCE (imported), not an inline callback. The
// callback resolves like a helper: the element binds to its first parameter, its
// reads fold into the operation, and the read-map attributes them to the function's
// own name (so `refresh()` can target it like any component).
export default function ListRoute({ params }: { params: { handle: string } }) {
  const products = glean.collection({ handle: params.handle }).products({ first: 10 }).nodes;
  return <ul>{products.map(renderRow)}</ul>;
}
```

**Input — render-row.tsx**

```tsx
import type { Product } from "~/graph/schema";

export function renderRow(product: Product) {
  return (
    <li>
      {product.title} — {product.priceRange.minVariantPrice.amount}
    </li>
  );
}
```

**Generated GraphQL**

```graphql
query ListRoute($handle: String!) {
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
}
```

**Variables factory**

```ts
export function getListRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}
```

**Read map**

```json
{
  "renderRow": [
    "Product.title",
    "Product.priceRange.minVariantPrice.amount"
  ]
}
```

## Map Destructured Param

`33-map-destructured-param`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";

// A DESTRUCTURED `.map` element (`({ title, handle: slug }) => …`): each bound name
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
}
```

**Generated GraphQL**

```graphql
query ListRoute($handle: String!) {
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
}
```

**Variables factory**

```ts
export function getListRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}
```

**Read map**

```json
{
  "ListRoute": [
    "Product.title",
    "Product.handle"
  ]
}
```

## Unsupported List Callback

`34-unsupported-list-callback`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
import type { Product } from "~/graph/schema";

// A dynamically-selected callback can't be analyzed. The compiler must SAY so — an
// `unsupported-list-flow` diagnostic — because staying silent would compile an
// operation that UNDER-FETCHES the callback's element reads.
const renderers: Record<string, (p: Product) => unknown> = {};

export default function ListRoute({ params }: { params: { handle: string; kind: string } }) {
  const products = glean.collection({ handle: params.handle }).products({ first: 10 }).nodes;
  return <ul>{products.map(renderers[params.kind])}</ul>;
}
```

**Generated GraphQL**

```graphql
query ListRoute($handle: String!) {
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
}
```

**Diagnostics**

```text
[unsupported-list-flow]
Cannot statically analyze the list callback renderers[params.kind].
Use an inline arrow/function, a reference to a named function, or a destructured
element parameter — the callback's element reads must be statically visible.
```

## Shared Param

`35-shared-param`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
import type { Product, Collection } from "~/graph/schema";

// The SAME route param feeds two different roots. Both root args are "simple"
// context paths named `handle`, so they must lift to ONE `$handle` variable
// (deduped definition + a single factory entry), not two.
export default function Route({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  const collection = glean.collection({ handle: params.handle });
  return (
    <>
      <ProductHero product={product} />
      <CollectionTitle collection={collection} />
    </>
  );
}

function ProductHero({ product }: { product: Product }) {
  return <h1>{product.title}</h1>;
}

function CollectionTitle({ collection }: { collection: Collection }) {
  return <h2>{collection.title}</h2>;
}
```

**Generated GraphQL**

```graphql
query Route($handle: String!) {
  product(handle: $handle) {
    __typename
    id
    title
  }
  collection(handle: $handle) {
    __typename
    id
    title
  }
}
```

**Variables factory**

```ts
export function getRouteVariables(ctx) {
  return {
    handle: ctx.params.handle,
  };
}
```

**Read map**

```json
{
  "ProductHero": [
    "Product.title"
  ],
  "CollectionTitle": [
    "Collection.title"
  ]
}
```

## Acceptance

`acceptance`

**Input — input.tsx**

```tsx
import { glean } from "~/graph";
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
}
```

**Generated GraphQL**

```graphql
query ProductRoute($handle: String!) {
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
}
```

**Read map**

```json
{
  "ProductHero": [
    "Product.title",
    "Product.featuredImage.url"
  ],
  "BuyBox": [
    "Product.priceRange.minVariantPrice.amount",
    "Product.priceRange.minVariantPrice.currencyCode"
  ]
}
```

---

36 fixtures. This page regenerates from the fixtures on every build.
