import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { createTestGraph, mockGraphFetch } from "@gleanql/client/testing";
import { GraphHydrator } from "@gleanql/client/client";
import { BuyBox } from "../src/app/components/BuyBox";
import { RenameTitle } from "../src/app/components/RenameTitle";

// The consumer testing story, end-to-end: a server component rendered against
// createTestGraph proxies, and a "use client" island hydrated through the
// generated <GraphHydrator> — with its compiled mutation intercepted on the
// wire. No GraphQL server anywhere; vitest.config.mts runs the same glean
// plugin as the app build, so the island's useMutation call is bound to the
// real compiled operation.

const PRODUCT = {
  __typename: "Product",
  id: "gid://product/1",
  handle: "aurora-mug",
  title: "Aurora Mug",
  priceRange: {
    __typename: "ProductPriceRange",
    minVariantPrice: { __typename: "MoneyV2", amount: "24.00", currencyCode: "USD" },
  },
};

afterEach(cleanup);

describe("server components against a test graph", () => {
  it("BuyBox renders the seeded price", () => {
    const { glean } = createTestGraph({ data: { product: PRODUCT } });
    render(<BuyBox product={glean.product({ handle: "aurora-mug" })} />);
    expect(screen.getByRole("button").textContent).toContain("24.00");
  });
});

describe("islands through the production hydration path", () => {
  it("RenameTitle reads the hydrated title, mutates over the mocked wire, and updates in place", async () => {
    const { payload } = createTestGraph({ data: { product: PRODUCT } });
    const mock = mockGraphFetch({
      RenameTitle_setProductTitle: (vars: Record<string, unknown>) => ({
        setProductTitle: { __typename: "Product", id: vars.id, title: vars.title },
      }),
    });
    try {
      render(
        <>
          <GraphHydrator payload={payload} />
          <RenameTitle handle="aurora-mug" id={PRODUCT.id} initialTitle="(fallback)" />
        </>,
      );

      // Warm read: the island sees the hydrated cache, not the fallback prop.
      expect(screen.getByText(/title: Aurora Mug/)).toBeDefined();

      // The mutation round-trips through the (mocked) wire and normalizes into
      // the same record — the island re-renders in place.
      fireEvent.click(screen.getByRole("button"));
      await waitFor(() => expect(screen.getByText(/title: ⚡ Renamed/)).toBeDefined());

      expect(mock.calls.length).toBe(1);
      expect(mock.calls[0]!.variables).toEqual({ id: PRODUCT.id, title: "⚡ Renamed" });
    } finally {
      mock.restore();
    }
  });
});
