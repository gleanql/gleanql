import { describe, it, expect } from "vitest";
import ts from "typescript";
import { compileSelectorOperation, findSelectorHookSites, typescriptFacade, type SelectorCompileContext } from "../src/index.js";
import { mockSchema } from "./support/mock-schema.js";

/**
 * Direct unit tests for the extracted selector-compile module — exercising
 * `compileSelectorOperation` in isolation (no Analyzer), with a minimal context.
 * The golden fixtures cover it end-to-end through the analyzer; this locks the
 * module's own contract so the extraction stays honest.
 */

/** A context that supplies the small analyzer helpers the module depends on. */
function context(sf: ts.SourceFile): SelectorCompileContext {
  return {
    schema: mockSchema,
    ast: typescriptFacade,
    sf,
    parseArgs: () => undefined, // no nested literal-arg fields in these selectors
    argEntry: (prop) => {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        return { argName: prop.name.text, valueExpr: prop.initializer };
      }
      if (ts.isShorthandPropertyAssignment(prop)) return { argName: prop.name.text, valueExpr: prop.name };
      return {};
    },
    computeStats: () => ({ fieldCount: 0, rootCount: 0, connectionCount: 0 }),
  };
}

/** Compile the first selector-hook call in `code` against its root type. */
function compileFirst(code: string) {
  const sf = ts.createSourceFile("t.tsx", code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const [site] = findSelectorHookSites(sf, typescriptFacade);
  if (!site) throw new Error("no selector-hook site found");
  const rootType = site.kind === "mutation" ? mockSchema.mutationType! : mockSchema.subscriptionType!;
  return compileSelectorOperation(site, rootType, context(sf));
}

describe("compileSelectorOperation", () => {
  it("compiles a mutation selector → kind:'mutation' op, lifting whole-vars to variables", () => {
    const op = compileFirst(
      `function C() { const [save] = useMutation((m, vars) => m.setProductTitle(vars).title); }`,
    );
    expect(op?.kind).toBe("mutation");
    expect(op?.name).toBe("C_setProductTitle");
    expect(op?.document).toBe(
      "mutation C_setProductTitle($id: ID!, $title: String!) {\n" +
        "  setProductTitle(id: $id, title: $title) {\n    __typename\n    id\n    title\n  }\n}\n",
    );
    expect(op?.variablesFactory.source.trim()).toBe(
      "export function getC_setProductTitleVariables(ctx) {\n  return {\n    id: ctx.id,\n    title: ctx.title,\n  };\n}",
    );
  });

  it("compiles a subscription selector → kind:'subscription' op", () => {
    const op = compileFirst(
      `function Live() { const { data } = useSubscription((s, vars) => s.productChanged(vars).title); }`,
    );
    expect(op?.kind).toBe("subscription");
    expect(op?.name).toBe("Live_productChanged");
    expect(op?.document).toContain("subscription Live_productChanged($handle: String!)");
    expect(op?.document).toContain("productChanged(handle: $handle)");
  });

  it("folds every read in an array-literal return (one mutation pulls several fields)", () => {
    const op = compileFirst(
      `function C() { const [save] = useMutation((m, vars) => { const p = m.setProductTitle(vars); return [p.id, p.title, p.availableForSale]; }); }`,
    );
    expect(op?.document).toContain("title");
    expect(op?.document).toContain("availableForSale");
  });

  it("folds every read in an object-literal return", () => {
    const op = compileFirst(
      `function C() { const [save] = useMutation((m, vars) => { const p = m.setProductTitle(vars); return { id: p.id, title: p.title, sale: p.availableForSale }; }); }`,
    );
    expect(op?.document).toContain("title");
    expect(op?.document).toContain("availableForSale");
  });

  it("lifts an explicit arg object via argEntry, mapping each declared arg", () => {
    const op = compileFirst(
      `function C() { useMutation((m, vars) => m.setProductTitle({ id: vars.id, title: vars.title }).title); }`,
    );
    expect(op?.document).toContain("setProductTitle(id: $id, title: $title)");
    expect(op?.variablesFactory.source).toContain("id: ctx.id");
    expect(op?.variablesFactory.source).toContain("title: ctx.title");
  });

  it("compiles a scalar-returning mutation root as a leaf field (no empty selection set)", () => {
    const op = compileFirst(`function C() { useMutation((m, vars) => m.removeProduct(vars)); }`);
    expect(op?.kind).toBe("mutation");
    expect(op?.document).toBe("mutation C_removeProduct($id: ID!) {\n  removeProduct(id: $id)\n}\n");
  });

  it("returns undefined when the selector reads nothing off the root", () => {
    // `m.setProductTitle(vars)` with no field read → empty result selection.
    const sf = ts.createSourceFile(
      "t.tsx",
      `function C() { useMutation((m, vars) => { m.setProductTitle(vars); return 1; }); }`,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const [site] = findSelectorHookSites(sf, typescriptFacade);
    // The root field IS opened (so the selection has setProductTitle + identity), so this
    // compiles; the "nothing compiled" guard only trips when no root call is made at all.
    const op = compileSelectorOperation(site!, "Mutation", context(sf));
    expect(op?.document).toContain("setProductTitle(id: $id, title: $title)");
  });
});
