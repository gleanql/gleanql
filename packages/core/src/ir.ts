/**
 * Query Intermediate Representation.
 *
 * The compiler never emits raw GraphQL strings. It produces this IR, which is
 * then merged/deduped (see merger.ts) and printed (see printer.ts). Keeping an
 * IR between extraction and printing is what lets us dedupe by canonical path,
 * inject identity fields, and (later) attach directives without string surgery.
 */

export type OperationKind = "query" | "mutation" | "subscription";

/** A GraphQL type reference, e.g. `String!` or `[Product!]!`. */
export type GraphQLTypeRef = string;

/**
 * An argument value. Arguments either reference an operation variable
 * (`q.var`) or carry a stable literal/enum/object/list value. Variable
 * references are how arbitrary argument expressions get lifted into the
 * generated variables factory; literals are what allow argument-level dedupe.
 */
export type ArgValue =
  | { readonly kind: "var"; readonly name: string }
  | { readonly kind: "literal"; readonly value: string | number | boolean | null }
  | { readonly kind: "enum"; readonly value: string }
  | { readonly kind: "list"; readonly items: readonly ArgValue[] }
  | { readonly kind: "object"; readonly fields: ReadonlyArray<readonly [string, ArgValue]> };

export type ArgMap = ReadonlyArray<readonly [string, ArgValue]>;

export interface Directive {
  readonly name: string;
  readonly args?: ArgMap;
}

export interface VariableDef {
  readonly name: string;
  readonly type: GraphQLTypeRef;
}

/**
 * A selection on a concrete object type. `fields` are keyed by response key
 * (the alias when present, otherwise the field name) and ordered for stable
 * printing. `inlineFragments` carry `... on T { ... }` for union/interface
 * narrowing.
 */
export interface SelectionSet {
  /** GraphQL type this selection set is evaluated against. */
  readonly typeName: string;
  readonly fields: readonly FieldSelection[];
  readonly inlineFragments?: readonly InlineFragment[];
}

export interface InlineFragment {
  readonly onType: string;
  readonly selection: SelectionSet;
}

export interface FieldSelection {
  /** GraphQL field name (not the alias). */
  readonly name: string;
  /** Response key. Only emitted when it differs from `name`. */
  readonly alias?: string;
  readonly args?: ArgMap;
  readonly directives?: readonly Directive[];
  /** Present for object/interface/union fields; absent for scalars/enums. */
  readonly selection?: SelectionSet;
}

export interface OperationIR {
  readonly kind: OperationKind;
  readonly name: string;
  readonly variables: readonly VariableDef[];
  readonly selection: SelectionSet;
}

/** Response key for a selection: alias if present, else the field name. */
export function responseKey(field: FieldSelection): string {
  return field.alias ?? field.name;
}
