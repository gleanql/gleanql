import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { analyzeWithTs } from "../src/index.js";
import { fileDerivedComponentName } from "../src/ast-facade.js";
import { mockSchema } from "./support/mock-schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const supportDir = path.join(here, "support");

describe("anonymous handler via default export", () => {
  const result = analyzeWithTs({
    fileName: path.join(here, "inline/orders.create.tsx"),
    supportDir,
    schema: mockSchema,
  });

  it("compiles the inline handler into one operation", () => {
    expect(result.operations).toHaveLength(1);
  });

  it("names the operation after the source file", () => {
    expect(result.operations[0]!.name).toBe("OrdersCreate");
    expect(result.operations[0]!.document).toMatch(/^query OrdersCreate\b/);
  });

  it("selects the fields the handler reads", () => {
    const doc = result.operations[0]!.document;
    expect(doc).toContain("product");
    expect(doc).toContain("title");
  });
});

describe("anonymous default function declaration", () => {
  const result = analyzeWithTs({
    fileName: path.join(here, "inline/order-status.tsx"),
    supportDir,
    schema: mockSchema,
  });

  it("compiles an anonymous `export default function` named from the file", () => {
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]!.name).toBe("OrderStatus");
    expect(result.operations[0]!.document).toMatch(/^query OrderStatus\b/);
  });
});

describe("await a glean root in an anonymous handler (server-handler pattern)", () => {
  const result = analyzeWithTs({
    fileName: path.join(here, "inline/booking.tsx"),
    supportDir,
    schema: mockSchema,
  });

  it("names the op after the file, marks it deferred, and traces reads on the awaited value", () => {
    expect(result.operations).toHaveLength(1);
    const op = result.operations[0]!;
    expect(op.name).toBe("Booking");
    expect(op.deferred).toBe(true);
    expect([...(op.runtimeVars ?? [])]).toEqual(["product_handle"]);
    // The read on `const product = await glean.product(...)` traces into the
    // operation — without the await-unwrap it would silently compile to
    // `product { __typename id }` (a runtime under-fetch, no build diagnostic).
    expect(op.document).toContain("title");
    expect(result.readMap["Booking"]).toContain("Product.title");
  });
});

describe("unawaited-deferred-read diagnostic (no false positives)", () => {
  const analyze = (file: string) => analyzeWithTs({ fileName: path.join(here, file), supportDir, schema: mockSchema });

  it("does NOT warn when an async component awaits the deferred read", () => {
    // `const p = await glean.product({ handle })` — the async path, no Suspense loop.
    expect(analyze("inline/deferred-awaited.tsx").diagnostics).toEqual([]);
  });

  it("does NOT warn for a synchronous (non-async) component's deferred read", () => {
    // A non-async component reads synchronously via a real Suspense boundary — fine.
    expect(analyze("inline/deferred-sync.tsx").diagnostics).toEqual([]);
  });
});

describe("fileDerivedComponentName", () => {
  it("derives a PascalCase name from the basename only", () => {
    expect(fileDerivedComponentName("/abs/src/webhooks/orders.create.ts")).toBe("OrdersCreate");
    expect(fileDerivedComponentName("app/proxy/order-status.tsx")).toBe("OrderStatus");
    expect(fileDerivedComponentName("index.ts")).toBe("Index");
  });
});
