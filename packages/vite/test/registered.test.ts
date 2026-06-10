import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineSchema, hashDocument } from "@gleanql/core";
import { addRegisteredOperations, loadRegisteredOperations } from "../src/registered.js";
import type { OperationArtifact } from "@gleanql/core";

const schema = defineSchema({
  queryType: "Query",
  types: [
    { name: "ID", kind: "scalar" },
    { name: "String", kind: "scalar" },
    { name: "Query", kind: "object", fields: { product: { name: "product", type: "Product" } } },
    {
      name: "Product",
      kind: "object",
      fields: {
        title: { name: "title", type: "String", nonNull: true },
        vendor: { name: "vendor", type: "String", nonNull: true },
      },
    },
  ],
});

const here = path.dirname(fileURLToPath(import.meta.url));
// Tests bundle against workspace source; a real app resolves the provisioned package.
const alias = { "@gleanql/core": path.resolve(here, "../../core/src/index.ts") };

function appWith(moduleSource: string): { appRoot: string; modulePath: string } {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "glean-registered-"));
  fs.writeFileSync(path.join(appRoot, "ops.ts"), moduleSource);
  return { appRoot, modulePath: "ops.ts" };
}

describe("loadRegisteredOperations", () => {
  it("runs the module and turns buildQuery exports into hashed, printable artifacts", async () => {
    const { appRoot, modulePath } = appWith(`
      import { buildQuery } from "@gleanql/core";
      // a helper export — must be ignored, not rejected
      export const columns = ["title", "vendor"];
      export const Report = buildQuery("Report", { handle: "String!" }, (root, $) => ({
        product: root.product({ handle: $.handle }, (p) => ({ title: p.title, vendor: p.vendor })),
      }));
    `);
    const ops = await loadRegisteredOperations(appRoot, modulePath, schema, { alias });

    expect(Object.keys(ops)).toEqual(["Report"]);
    const op = ops.Report!;
    expect(op.kind).toBe("query");
    expect(op.document).toContain("query Report($handle: String!)");
    expect(op.document).toContain("product(handle: $handle)");
    expect(op.hash).toBe(hashDocument(op.document)); // the persisted-allowlist id
    expect(op.stats).toEqual({ fieldCount: 3, rootCount: 1, connectionCount: 0 });
    expect(op.variablesFactory.source).toContain("getReportVariables");
    expect(op.source).toBe(modulePath);
  });

  it("fails loudly when the module registers nothing (misconfigured path ≠ silent empty allowlist)", async () => {
    const { appRoot, modulePath } = appWith(`export const notAnOperation = { foo: 1 };`);
    await expect(loadRegisteredOperations(appRoot, modulePath, schema, { alias })).rejects.toThrow(/exports no operations/);
  });

  it("rejects two exports with the same operation name", async () => {
    const { appRoot, modulePath } = appWith(`
      import { buildQuery } from "@gleanql/core";
      export const A = buildQuery("Same", {}, (root) => ({ product: root.product({}, (p) => ({ title: p.title })) }));
      export const B = buildQuery("Same", {}, (root) => ({ product: root.product({}, (p) => ({ vendor: p.vendor })) }));
    `);
    await expect(loadRegisteredOperations(appRoot, modulePath, schema, { alias })).rejects.toThrow(/two operations named "Same"/);
  });
});

describe("addRegisteredOperations", () => {
  const compiled = (name: string): OperationArtifact =>
    ({ name, kind: "query", document: "query {}", hash: "h", source: "src/routes/page.tsx" }) as OperationArtifact;

  it("merges disjoint names and errors on a collision with a compiled operation", () => {
    const target: Record<string, OperationArtifact> = { Page: compiled("Page") };
    addRegisteredOperations(target, { Report: compiled("Report") });
    expect(Object.keys(target).sort()).toEqual(["Page", "Report"]);
    expect(() => addRegisteredOperations(target, { Page: compiled("Page") })).toThrow(
      /collides with the compiled operation from src\/routes\/page\.tsx/,
    );
  });
});
