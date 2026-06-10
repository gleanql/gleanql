/**
 * A tiny classic-pragma JSX runtime for the runnable example — just enough to
 * execute the route as a real component tree (no React dependency). App files
 * opt in with `/** @jsx h *​/`. esbuild (vitest) compiles `<section>…</section>`
 * into `h("section", …)`.
 */

export type VNode =
  | { readonly kind: "element"; readonly tag: string; readonly props: Record<string, unknown>; readonly children: readonly VNode[] }
  | { readonly kind: "component"; readonly fn: (props: Record<string, unknown>) => unknown; readonly props: Record<string, unknown> }
  | { readonly kind: "fragment"; readonly children: readonly VNode[] }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "empty" };

export const Fragment = Symbol.for("graph.example.Fragment");

type Child = unknown;

export function h(type: unknown, props: Record<string, unknown> | null, ...children: Child[]): VNode {
  const kids = flattenChildren(children);
  if (type === Fragment) return { kind: "fragment", children: kids };
  if (typeof type === "function") {
    return { kind: "component", fn: type as (p: Record<string, unknown>) => unknown, props: { ...(props ?? {}), children: kids } };
  }
  return { kind: "element", tag: String(type), props: props ?? {}, children: kids };
}

/** Coerce any render output (VNode | string | number | array | nullish) into a VNode. */
export function toVNode(value: unknown): VNode {
  if (value == null || value === false || value === true) return { kind: "empty" };
  if (Array.isArray(value)) return { kind: "fragment", children: value.map(toVNode) };
  if (typeof value === "object" && "kind" in (value as object)) return value as VNode;
  return { kind: "text", value: String(value) };
}

function flattenChildren(children: readonly Child[]): VNode[] {
  const out: VNode[] = [];
  for (const child of children) {
    if (Array.isArray(child)) out.push(...flattenChildren(child));
    else out.push(toVNode(child));
  }
  return out;
}
