import { toVNode, type VNode } from "./jsx-runtime.js";

/**
 * A minimal async server renderer with mini-Suspense. When a component reads a
 * graph field that is missing, the proxy throws a promise; the renderer catches
 * it, awaits the batched fetch, and retries the component — the same contract
 * React Suspense provides, in ~30 lines.
 */
const VOID_ELEMENTS = new Set(["img", "br", "hr", "input", "meta", "link"]);

export async function renderToString(node: VNode): Promise<string> {
  switch (node.kind) {
    case "empty":
      return "";
    case "text":
      return escapeText(node.value);
    case "fragment":
      return (await Promise.all(node.children.map(renderToString))).join("");
    case "element": {
      const attrs = renderAttrs(node.props);
      if (VOID_ELEMENTS.has(node.tag)) return `<${node.tag}${attrs}>`;
      const inner = (await Promise.all(node.children.map(renderToString))).join("");
      return `<${node.tag}${attrs}>${inner}</${node.tag}>`;
    }
    case "component": {
      for (;;) {
        try {
          return await renderToString(toVNode(node.fn(node.props)));
        } catch (thrown) {
          if (thrown instanceof Promise) {
            await thrown; // a suspended field read — wait for the batched fetch, then retry
            continue;
          }
          throw thrown;
        }
      }
    }
  }
}

function renderAttrs(props: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(props)) {
    if (key === "children" || value == null || typeof value === "function" || typeof value === "object") continue;
    if (typeof value === "boolean") {
      if (value) parts.push(` ${key}`);
      continue;
    }
    parts.push(` ${key}="${escapeAttr(String(value))}"`);
  }
  return parts.join("");
}

function escapeText(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}
