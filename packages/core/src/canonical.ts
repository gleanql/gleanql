import type { ArgValue, ArgMap, Directive } from "./ir.js";

/** Lexicographic string comparator, for stable order-independent sorts. */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Canonical, order-independent string identity for an argument value. Two
 * fields dedupe only when their canonical args (and name/directives/type)
 * match; differing args force aliases. Object/list args are normalized so
 * `{ a: 1, b: 2 }` and `{ b: 2, a: 1 }` are identical.
 */
export function canonicalArgValue(value: ArgValue): string {
  switch (value.kind) {
    case "var":
      return `$${value.name}`;
    case "literal":
      return JSON.stringify(value.value);
    case "enum":
      return `enum:${value.value}`;
    case "list":
      return `[${value.items.map(canonicalArgValue).join(",")}]`;
    case "object": {
      const sorted = [...value.fields].sort(([a], [b]) => compareStrings(a, b));
      return `{${sorted.map(([k, v]) => `${k}:${canonicalArgValue(v)}`).join(",")}}`;
    }
  }
}

export function canonicalArgs(args: ArgMap | undefined): string {
  if (!args || args.length === 0) return "";
  const sorted = [...args].sort(([a], [b]) => compareStrings(a, b));
  return sorted.map(([k, v]) => `${k}:${canonicalArgValue(v)}`).join(",");
}

export function canonicalDirectives(directives: readonly Directive[] | undefined): string {
  if (!directives || directives.length === 0) return "";
  return [...directives]
    .sort((a, b) => compareStrings(a.name, b.name))
    .map((d) => `@${d.name}(${canonicalArgs(d.args)})`)
    .join("");
}

/**
 * Stable, human-readable suffix derived from arguments, used to build aliases
 * when the same field appears with differing args (e.g. `products(first: 12)`
 * and `products(first: 24)` -> `products_first12` / `products_first24`).
 */
export function argAliasSuffix(args: ArgMap | undefined): string {
  if (!args || args.length === 0) return "";
  const parts: string[] = [];
  const walk = (key: string, value: ArgValue): void => {
    switch (value.kind) {
      case "literal":
        parts.push(`${key}${stringifyScalar(value.value)}`);
        break;
      case "enum":
        parts.push(`${key}${value.value}`);
        break;
      case "var":
        parts.push(`${key}Var${capitalize(value.name)}`);
        break;
      case "list":
        value.items.forEach((item, i) => walk(`${key}${i}`, item));
        break;
      case "object":
        for (const [k, v] of [...value.fields].sort(([a], [b]) => compareStrings(a, b))) {
          walk(`${key}${capitalize(k)}`, v);
        }
        break;
    }
  };
  for (const [k, v] of args) walk(k, v);
  return parts.join("");
}

function stringifyScalar(value: string | number | boolean | null): string {
  if (value === null) return "Null";
  if (typeof value === "string") return value.replace(/[^A-Za-z0-9]/g, "");
  return String(value);
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
