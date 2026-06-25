import { describe, it, expect } from "vitest";
import { bindSelectorHookOps } from "../src/mutation-bind.js";

const bindMutationOps = bindSelectorHookOps;

describe("bindSelectorHookOps (useMutation/useSubscription(selector) → op-name bound)", () => {
  it("injects the op name as a third argument, padding the missing options arg", () => {
    const out = bindMutationOps(
      `import { useMutation } from "@gleanql/client/client";\n` +
        `export function EditTitle({ id }) {\n` +
        `  const [save] = useMutation((m, vars) => m.setProductTitle(vars).title);\n` +
        `  return null;\n}\n`,
      "EditTitle.tsx",
    );
    expect(out).toContain('useMutation((m, vars) => m.setProductTitle(vars).title, undefined, "EditTitle_setProductTitle")');
  });

  it("injects after an existing options object (second arg)", () => {
    const out = bindMutationOps(
      `import { useMutation } from "@gleanql/client/client";\n` +
        `function Cmp() {\n` +
        `  const [save] = useMutation((m, vars) => m.setProductTitle(vars).title, { onCompleted: () => {} });\n` +
        `  return null;\n}\n`,
      "Cmp.tsx",
    );
    expect(out).toContain('{ onCompleted: () => {} }, "Cmp_setProductTitle")');
  });

  it("disambiguates multiple mutations of the same field in one component", () => {
    const out = bindMutationOps(
      `import { useMutation } from "@gleanql/client/client";\n` +
        `function Cmp() {\n` +
        `  const [a] = useMutation((m, v) => m.setProductTitle(v).title);\n` +
        `  const [b] = useMutation((m, v) => m.setProductTitle(v).id);\n` +
        `  return null;\n}\n`,
      "Cmp.tsx",
    );
    expect(out).toContain('"Cmp_setProductTitle")');
    expect(out).toContain('"Cmp_setProductTitle_2")');
  });

  it("handles a trailing comma in the call without producing a double comma", () => {
    const out = bindMutationOps(
      `import { useMutation } from "@gleanql/client/client";\n` +
        `function C() {\n` +
        `  const [s] = useMutation(\n    (m, v) => m.setProductTitle(v).title,\n  );\n` +
        `  return null;\n}\n`,
      "C.tsx",
    );
    expect(out).toContain('.title, undefined, "C_setProductTitle"');
    expect(out).not.toContain(",,");
  });

  it("binds useSubscription calls too", () => {
    const out = bindSelectorHookOps(
      `import { useSubscription } from "@gleanql/client/client";\n` +
        `export function LiveTitle({ handle }) {\n` +
        `  const { data } = useSubscription((s, vars) => s.productChanged(vars).title);\n` +
        `  return null;\n}\n`,
      "LiveTitle.tsx",
    );
    expect(out).toContain('useSubscription((s, vars) => s.productChanged(vars).title, undefined, "LiveTitle_productChanged")');
  });

  it("binds the server `mutate(selector, vars)` primitive (imported from the framework)", () => {
    const out = bindSelectorHookOps(
      `import { mutate } from "@shoplayer/framework";\n` +
        `export async function bookShipment(args) {\n` +
        `  const res = await mutate((m, vars) => m.fulfillmentCreate(vars).fulfillment.id, { id: args.id });\n` +
        `  return res;\n}\n`,
      "booking.ts",
    );
    expect(out).toContain(
      'mutate((m, vars) => m.fulfillmentCreate(vars).fulfillment.id, { id: args.id }, "bookShipment_fulfillmentCreate")',
    );
  });

  it("leaves already-bound calls (three args) and non-glue files alone", () => {
    const bound =
      `import { useMutation } from "@gleanql/client/client";\n` +
      `function C() { const [s] = useMutation((m, v) => m.setProductTitle(v).title, undefined, "C_setProductTitle"); return null; }\n`;
    expect(bindMutationOps(bound, "C.tsx")).toBeNull();
    expect(bindMutationOps(`function C(){ useMutation(() => {}); }`, "C.tsx")).toBeNull(); // not imported from the glue
  });
});
