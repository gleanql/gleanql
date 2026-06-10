---
title: Testing your app
group: Guide
order: 4
---

# Testing your app

Components that read graph fields are still plain components. The harness in
`@gleanql/client/testing` renders them against a **real runtime seeded from
plain JSON** — no GraphQL server in the test process. The schema is baked in
by the build, so a test states only what it's about: the data.

```bash
# vitest, jest, node:test — anything; the harness is renderer-agnostic
pnpm add -D vitest
```

## Server components: call them with a test graph

A server component takes graph values as props — so hand it proxies from
`createTestGraph` and assert on the output:

```tsx
import { describe, it, expect } from "vitest";
import { createTestGraph } from "@gleanql/client/testing";
import { BuyBox } from "../src/components/BuyBox";

it("renders the price", () => {
  const { glean } = createTestGraph({
    data: {
      product: {
        __typename: "Product",
        id: "p1",
        title: "Cool Shirt",
        priceRange: {
          __typename: "ProductPriceRange",
          minVariantPrice: { __typename: "MoneyV2", amount: "39.00", currencyCode: "EUR" },
        },
      },
    },
  });

  const ui = BuyBox({ product: glean.product({ handle: "cool-shirt" }) });
  // assert with your renderer of choice — react-test-renderer, RTL, or plain props
});
```

`data` is operation-shaped JSON — root fields at the top, `__typename` on every
object (plus `id` where the type has one) so records normalize by identity,
exactly as a server response would. The reads are **fully typed**: `glean` has
the same generated type as your app's accessor.

> [!NOTE]
> **Unseeded reads fail loudly.** Reading a field you didn't seed rejects with
> the field's name — a test should seed everything it renders. If you want the
> generated client's lenient behavior instead, pass `onMiss: "undefined"`.

## Islands: hydrate the real client

`useGlean()` islands read from the generated client's cache. The harness's
`payload` rides the **production hydration path** — wrap the island in the
generated `<GraphHydrator>` (RSC) or call `hydrate()` (React Router) and the
hooks read warm in jsdom:

```tsx
// vitest.config: environment: "jsdom"
import { render, screen } from "@testing-library/react";
import { GraphHydrator } from "@gleanql/client/client";
import { createTestGraph } from "@gleanql/client/testing";
import { Availability } from "../src/components/Availability";

it("shows stock from the hydrated cache", () => {
  const { payload } = createTestGraph({
    data: { product: { __typename: "Product", id: "p1", availableForSale: true } },
  });

  render(
    <>
      <GraphHydrator payload={payload} />
      <Availability handle="cool-shirt" />
    </>,
  );
  expect(screen.getByText("In stock")).toBeDefined();
});
```

On React Router, call `hydrate(payload)` from `@gleanql/client/client` before
rendering instead.

## Mutations & refetch: intercept the wire

An island's `useMutation` / `refresh()` posts to the graph endpoint. In jsdom,
`mockGraphFetch` answers by operation name and records every call — no msw
setup, though msw works too (match on `operationName` in the POST body):

```tsx
import { mockGraphFetch } from "@gleanql/client/testing";

it("renames the product optimistically", async () => {
  const mock = mockGraphFetch({
    ProductUpdate: (vars) => ({ productUpdate: { __typename: "Product", id: "p1", title: vars.title } }),
  });
  try {
    // …render the island, click the button…
    expect(mock.calls).toEqual([{ name: "ProductUpdate", kind: "query", variables: { id: "p1", title: "Renamed" } }]);
  } finally {
    mock.restore();
  }
});
```

A handler returns the operation's **data**; return `{ errors: [{ message }] }`
to exercise the failure path (optimistic writes roll back, `state.error`
populates).

> [!NOTE]
> **Operation names.** A compiled selector operation is named
> `<Component>_<rootField>` (e.g. `RenameTitle_setProductTitle`); route
> operations are named after the route. Every name is listed on `/__glean`
> and in `generated/persisted.json`. An unmatched request renders the island's
> error state with `mockGraphFetch: no handler for "<name>"` — the test tells
> you the name it wanted.

> [!NOTE]
> **Bound call sites.** `useMutation`/`useSubscription` call sites are bound to
> their compiled operations *by the build* — so a jsdom test of a mutation
> island needs the glean plugin in `vitest.config.ts` (same options as the
> app's `vite.config.ts`). `examples/rwsdk-real/vitest.config.mts` +
> `tests/harness.test.tsx` show the complete working setup.

## Server-side code: a recording adapter

`runRoute`, `runMutation`, and integration-level code take an adapter — pass
`createMockAdapter` and assert on what crossed it. Subscriptions are
push-driven:

```tsx
import { createMockAdapter } from "@gleanql/client/testing";

const adapter = createMockAdapter({
  ProductRoute: { product: { __typename: "Product", id: "p1", title: "Hi" } },
});

// … run the route/mutation with `adapter` …
expect(adapter.calls[0].name).toBe("ProductRoute");

// subscriptions: push payloads, then end the stream
adapter.push("PriceChanged", { priceChanged: { __typename: "MoneyV2", amount: "2.00" } });
adapter.end("PriceChanged");
```

## What you're actually testing

The harness deliberately reuses the production machinery — `createTestGraph`
seeds through the same normalizer a server response goes through, the payload
hydrates through the same path the flight stream uses, and reads go through the
same proxies. There is no parallel "test mode" runtime: if it works in the
test, it's the real code path that worked.

What it does **not** cover is the compile step — whether your route compiles to
the operation you expect. That's what the build is for: an unanalyzable read is
a build error, and `/__glean` shows every compiled operation. CI-grade
assertion lives in `strict: true` ([@gleanql/vite](vite.md)).

## Where next

- [Using GleanQL](usage.md) — the task tour this page tests against.
- [@gleanql/client](runtime.md) — the runtime the harness seeds.
- [vs Relay & gqty](comparison.md) — how the testing story compares.
