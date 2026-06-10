import { describe, it, expect } from "vitest";
import { q } from "../src/builder.js";
import { mergeOperations } from "../src/merger.js";
import { printOperation } from "../src/printer.js";
import type { OperationIR } from "../src/ir.js";
import { mockSchema } from "./mock-schema.js";
import { validateDocument } from "./validate.js";

/**
 * The IR can express directives (@include/@skip and contextual ones) even
 * though v1 exposes no public directive API. They survive merging and printing
 * and produce valid GraphQL.
 */
describe("directives in the IR", () => {
  const op: OperationIR = q.operation({
    kind: "query",
    name: "ProductRoute",
    variables: { handle: "String!", expanded: "Boolean!" },
    selection: q.select("Query", {
      product: q.field("product", {
        args: q.args({ handle: q.var("handle") }),
        selection: q.select("Product", {
          title: q.scalar("title"),
          descriptionHtml: q.scalar("descriptionHtml", {
            directives: [{ name: "include", args: q.args({ if: q.var("expanded") }) }],
          }),
        }),
      }),
    }),
  });

  const printed = printOperation(mergeOperations("ProductRoute", [op], mockSchema));

  it("prints field directives", () => {
    expect(printed).toContain("descriptionHtml @include(if: $expanded)");
  });

  it("is valid GraphQL", () => {
    expect(validateDocument(printed)).toEqual([]);
  });
});
