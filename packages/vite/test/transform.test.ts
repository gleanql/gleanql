import { describe, it, expect, vi } from "vitest";
import { wrapRouteComponents } from "../src/transform.js";

const names = (...n: string[]) => new Set(n);

describe("wrapRouteComponents (RSC hydrator auto-inject)", () => {
  it("wraps an `export function` route component, preserving the export name", () => {
    const out = wrapRouteComponents(
      `export function ProductPage({ params }) { return <main>{params.handle}</main>; }`,
      "ProductPage.tsx",
      names("ProductPage"),
    );
    expect(out).not.toBeNull();
    expect(out).toContain('import { withGraphHydration as __graphWithHydration } from "@gleanql/client/server";');
    expect(out).toContain("function __graphInner_ProductPage({ params })"); // renamed local
    expect(out).not.toContain("export function ProductPage"); // export stripped
    expect(out).toContain("export const ProductPage = __graphWithHydration(__graphInner_ProductPage);");
  });

  it("wraps an `export const` arrow component", () => {
    const out = wrapRouteComponents(
      `export const CollectionPage = ({ params }) => <ul>{params.handle}</ul>;`,
      "CollectionPage.tsx",
      names("CollectionPage"),
    );
    expect(out).toContain("const __graphInner_CollectionPage = ({ params }) =>");
    expect(out).toContain("export const CollectionPage = __graphWithHydration(__graphInner_CollectionPage);");
  });

  it("wraps `export default function`", () => {
    const out = wrapRouteComponents(
      `export default function Page() { return null; }`,
      "Page.tsx",
      names("Page"),
    );
    expect(out).toContain("function __graphInner_Page()");
    expect(out).toContain("export default __graphWithHydration(__graphInner_Page);");
  });

  it("preserves `async` on `export default async function` (await stays valid)", () => {
    const out = wrapRouteComponents(
      `export default async function Page() { const x = await load(); return <main>{x}</main>; }`,
      "Page.tsx",
      names("Page"),
    );
    expect(out).not.toBeNull();
    // `async` must survive — otherwise `await` lands in a non-async function.
    expect(out).toContain("async function __graphInner_Page()");
    expect(out).not.toMatch(/(?<!async )function __graphInner_Page\(\)/);
    expect(out).toContain("export default __graphWithHydration(__graphInner_Page);");
  });

  it("preserves `async` on `export async function`", () => {
    const out = wrapRouteComponents(
      `export async function Orders() { const x = await load(); return <ul>{x}</ul>; }`,
      "Orders.tsx",
      names("Orders"),
    );
    expect(out).toContain("async function __graphInner_Orders()");
    expect(out).not.toContain("export async function Orders");
    expect(out).toContain("export const Orders = __graphWithHydration(__graphInner_Orders);");
  });

  it("wraps `export { Local as Name }` (rename re-export)", () => {
    const out = wrapRouteComponents(
      `function Impl() { return null; }\nexport { Impl as ProductPage };`,
      "ProductPage.tsx",
      names("ProductPage"),
    );
    expect(out).toContain("export const ProductPage = __graphWithHydration(Impl);");
    expect(out).not.toContain("Impl as ProductPage");
  });

  it("skips `use client` modules and warns", () => {
    const warn = vi.fn();
    const out = wrapRouteComponents(
      `"use client";\nexport function Page() { return null; }`,
      "Page.tsx",
      names("Page"),
      warn,
    );
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('"use client"'));
  });

  it("returns null (no change) when no route components match", () => {
    expect(wrapRouteComponents(`export const x = 1;`, "x.ts", names("Page"))).toBeNull();
  });

  it("leaves untouched + warns for unsupported export forms", () => {
    const warn = vi.fn();
    // mixed multi-declarator export — too ambiguous to split.
    const out = wrapRouteComponents(
      `export const A = 1, Page = () => null;`,
      "Page.tsx",
      names("Page"),
      warn,
    );
    expect(out).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Page"));
  });

  it("only rewrites the matched export, leaving siblings alone", () => {
    const out = wrapRouteComponents(
      `export function ProductPage() { return null; }\nexport function Helper() { return null; }`,
      "ProductPage.tsx",
      names("ProductPage"),
    );
    expect(out).toContain("export function Helper()"); // untouched
    expect(out).toContain("export const ProductPage = __graphWithHydration(__graphInner_ProductPage);");
  });
});
