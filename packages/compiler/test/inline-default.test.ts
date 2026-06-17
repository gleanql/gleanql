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

describe("fileDerivedComponentName", () => {
  it("derives a PascalCase name from the basename only", () => {
    expect(fileDerivedComponentName("/abs/src/webhooks/orders.create.ts")).toBe("OrdersCreate");
    expect(fileDerivedComponentName("app/proxy/order-status.tsx")).toBe("OrderStatus");
    expect(fileDerivedComponentName("index.ts")).toBe("Index");
  });
});
