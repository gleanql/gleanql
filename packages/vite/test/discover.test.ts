import { describe, it, expect } from "vitest";
import { isRouteFile } from "../src/generate.js";

const roots = ["product", "collection", "search"];

describe("isRouteFile (route auto-discovery probe)", () => {
  it("matches a file that opens a glean root", () => {
    expect(isRouteFile(`const p = glean.product({ handle });`, roots)).toBe(true);
    expect(isRouteFile(`glean.collection({ handle: params.handle })`, roots)).toBe(true);
    expect(isRouteFile(`glean . search ( { query } )`, roots)).toBe(true); // tolerant of spacing
  });

  it("ignores component files that only read glean fields via props", () => {
    expect(isRouteFile(`function Card({ product }) { return product.title; }`, roots)).toBe(false);
    expect(isRouteFile(`import type { Product } from "@gleanql/client/schema";`, roots)).toBe(false);
  });

  it("does not match a non-root method or a similarly-named identifier", () => {
    expect(isRouteFile(`glean.components({ card })`, roots)).toBe(false);
    expect(isRouteFile(`paraglean.product(x)`, roots)).toBe(false); // word boundary before `glean`
    expect(isRouteFile(`glean.productCount(x)`, roots)).toBe(false); // exact root name, not a prefix
  });

  it("is false when the schema has no roots", () => {
    expect(isRouteFile(`glean.product({ handle })`, [])).toBe(false);
  });

  it("excludes `use client` islands even when they open a glean root", () => {
    // A client island reads the hydrated cache; it is never an RSC route entrypoint.
    expect(isRouteFile(`"use client";\nconst p = glean.product({ handle });`, roots)).toBe(false);
    expect(isRouteFile(`'use client'\nglean.collection({ handle })`, roots)).toBe(false);
    // ...tolerating leading comments/whitespace before the directive.
    expect(isRouteFile(`// island\n  "use client";\nglean.product({ handle })`, roots)).toBe(false);
    // A normal server route is still matched.
    expect(isRouteFile(`glean.product({ handle })`, roots)).toBe(true);
  });
});
