import type {
  ArgMap,
  ArgValue,
  Directive,
  FieldSelection,
  InlineFragment,
  OperationIR,
  SelectionSet,
} from "./ir.js";

/**
 * Deterministic GraphQL printer for the IR. Two-space indentation, fields in
 * IR order (the merger has already canonicalized that order). This is the only
 * place IR becomes a GraphQL string.
 */

/**
 * Opt-in named-fragment extraction. A sub-selection that appears identically in
 * several places (a shared component's read merged under two roots) is printed
 * once as `fragment <TypeName>Fields on <TypeName>` and spread at each site —
 * the wire document shrinks, the response shape is unchanged. OFF by default:
 * extraction only changes the document text, so existing emitted operations
 * stay byte-identical unless a caller asks for it.
 */
export interface FragmentOptions {
  /** Identical occurrences required before a selection is extracted (default 2). */
  readonly minUses?: number;
  /** Direct selections (fields + inline fragments) a candidate needs (default 3 — skips bare `__typename id` identity pairs). */
  readonly minSelections?: number;
}

export interface PrintOptions {
  readonly indent?: string;
  /** Extract repeated identical object selections into named fragments. `true` = defaults. */
  readonly fragments?: boolean | FragmentOptions;
}

export function printOperation(op: OperationIR, options: PrintOptions = {}): string {
  const indent = options.indent ?? "  ";
  const plan = options.fragments
    ? planFragments(op, options.fragments === true ? {} : options.fragments)
    : undefined;
  const header = `${op.kind} ${op.name}${printVariableDefs(op.variables)}`;
  const body = printSelectionSet(op.selection, indent, 1, plan);
  const defs = plan && plan.size > 0 ? "\n" + printFragmentDefs(plan, indent) : "";
  return `${header} ${body}\n${defs}`;
}

function printVariableDefs(variables: OperationIR["variables"]): string {
  if (variables.length === 0) return "";
  const defs = variables.map((v) => `$${v.name}: ${v.type}`).join(", ");
  return `(${defs})`;
}

/** Extracted fragments, keyed by the selection's canonical form. */
type FragmentPlan = ReadonlyMap<string, { readonly name: string; readonly set: SelectionSet }>;

/** Canonical identity of a selection set (merger output is order-stable, so identical reads stringify identically). */
const keyCache = new WeakMap<SelectionSet, string>();
function canonicalKey(set: SelectionSet): string {
  let key = keyCache.get(set);
  if (key === undefined) {
    key = JSON.stringify(set);
    keyCache.set(set, key);
  }
  return key;
}

/** Count every (non-root) object selection; selections repeated enough — and big enough — become fragments. */
function planFragments(op: OperationIR, options: FragmentOptions): FragmentPlan {
  const minUses = options.minUses ?? 2;
  const minSelections = options.minSelections ?? 3;

  const seen = new Map<string, { set: SelectionSet; count: number }>();
  const record = (set: SelectionSet): void => {
    const key = canonicalKey(set);
    const entry = seen.get(key);
    if (entry) entry.count++;
    else seen.set(key, { set, count: 1 });
  };
  const visit = (set: SelectionSet): void => {
    for (const field of set.fields) {
      if (field.selection) {
        record(field.selection);
        visit(field.selection);
      }
    }
    for (const frag of set.inlineFragments ?? []) {
      record(frag.selection);
      visit(frag.selection);
    }
  };
  visit(op.selection);

  const plan = new Map<string, { name: string; set: SelectionSet }>();
  const taken = new Set<string>();
  for (const [key, { set, count }] of seen) {
    const size = set.fields.length + (set.inlineFragments?.length ?? 0);
    if (count < minUses || size < minSelections) continue;
    let name = `${set.typeName}Fields`;
    for (let i = 2; taken.has(name); i++) name = `${set.typeName}Fields${i}`;
    taken.add(name);
    plan.set(key, { name, set });
  }
  return plan;
}

/**
 * Print each fragment definition, in first-extraction order. Bodies print
 * through the same plan, so a fragment containing another repeated selection
 * spreads it (`...ImageFields`) instead of inlining it again. A body can never
 * spread itself: replacement happens at the FIELD level, and a selection can't
 * structurally contain itself.
 */
function printFragmentDefs(plan: FragmentPlan, indent: string): string {
  const defs: string[] = [];
  for (const { name, set } of plan.values()) {
    defs.push(`fragment ${name} on ${set.typeName} ${printSelectionSet(set, indent, 1, plan)}\n`);
  }
  return defs.join("\n");
}

function printSelectionSet(set: SelectionSet, indent: string, depth: number, plan?: FragmentPlan): string {
  const lines: string[] = [];
  for (const field of set.fields) {
    lines.push(printField(field, indent, depth, plan));
  }
  for (const frag of set.inlineFragments ?? []) {
    lines.push(printInlineFragment(frag, indent, depth, plan));
  }
  const inner = lines.join("\n");
  const closingPad = indent.repeat(depth - 1);
  return `{\n${inner}\n${closingPad}}`;
}

/** A selection covered by the plan prints as its spread; otherwise inline as usual. */
function printSelectionOrSpread(set: SelectionSet, indent: string, depth: number, plan?: FragmentPlan): string {
  const fragment = plan?.get(canonicalKey(set));
  if (fragment) {
    const pad = indent.repeat(depth);
    return `{\n${pad}...${fragment.name}\n${indent.repeat(depth - 1)}}`;
  }
  return printSelectionSet(set, indent, depth, plan);
}

function printField(field: FieldSelection, indent: string, depth: number, plan?: FragmentPlan): string {
  const pad = indent.repeat(depth);
  const aliasPart = field.alias ? `${field.alias}: ` : "";
  const argsPart = printArgs(field.args);
  const directivesPart = printDirectives(field.directives);
  const head = `${pad}${aliasPart}${field.name}${argsPart}${directivesPart}`;
  if (field.selection) {
    return `${head} ${printSelectionOrSpread(field.selection, indent, depth + 1, plan)}`;
  }
  return head;
}

function printInlineFragment(frag: InlineFragment, indent: string, depth: number, plan?: FragmentPlan): string {
  const pad = indent.repeat(depth);
  return `${pad}... on ${frag.onType} ${printSelectionOrSpread(frag.selection, indent, depth + 1, plan)}`;
}

function printDirectives(directives: readonly Directive[] | undefined): string {
  if (!directives || directives.length === 0) return "";
  return directives.map((d) => ` @${d.name}${printArgs(d.args)}`).join("");
}

export function printArgs(args: ArgMap | undefined): string {
  if (!args || args.length === 0) return "";
  const parts = args.map(([name, value]) => `${name}: ${printArgValue(value)}`);
  return `(${parts.join(", ")})`;
}

export function printArgValue(value: ArgValue): string {
  switch (value.kind) {
    case "var":
      return `$${value.name}`;
    case "literal":
      return JSON.stringify(value.value);
    case "enum":
      return value.value;
    case "list":
      return `[${value.items.map(printArgValue).join(", ")}]`;
    case "object":
      return `{${value.fields.map(([k, v]) => `${k}: ${printArgValue(v)}`).join(", ")}}`;
  }
}
