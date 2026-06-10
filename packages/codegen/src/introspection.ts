/**
 * GraphQL introspection model + type-ref helpers.
 *
 * We consume the standard introspection result (`data.__schema`) directly rather
 * than depend on graphql-js at runtime — the shape is stable and small. These
 * structural types match what `introspectionFromSchema()` produces, so a real
 * introspection drops straight in.
 */

export type IntrospectionTypeKind = "SCALAR" | "OBJECT" | "INTERFACE" | "UNION" | "ENUM" | "INPUT_OBJECT" | "LIST" | "NON_NULL";

export type IntrospectionTypeRef =
  | { readonly kind: "NON_NULL"; readonly ofType: IntrospectionTypeRef }
  | { readonly kind: "LIST"; readonly ofType: IntrospectionTypeRef }
  | { readonly kind: "SCALAR" | "OBJECT" | "INTERFACE" | "UNION" | "ENUM" | "INPUT_OBJECT"; readonly name: string; readonly ofType?: null };

export interface IntrospectionInputValue {
  readonly name: string;
  readonly type: IntrospectionTypeRef;
  readonly defaultValue?: string | null;
}

export interface IntrospectionField {
  readonly name: string;
  readonly args: readonly IntrospectionInputValue[];
  readonly type: IntrospectionTypeRef;
}

export interface IntrospectionType {
  readonly kind: IntrospectionTypeKind;
  readonly name: string;
  readonly description?: string | null;
  readonly fields?: readonly IntrospectionField[] | null;
  readonly inputFields?: readonly IntrospectionInputValue[] | null;
  readonly interfaces?: readonly IntrospectionTypeRef[] | null;
  readonly enumValues?: ReadonlyArray<{ readonly name: string }> | null;
  readonly possibleTypes?: readonly IntrospectionTypeRef[] | null;
}

export interface IntrospectionSchema {
  readonly queryType: { readonly name: string };
  readonly mutationType?: { readonly name: string } | null;
  readonly subscriptionType?: { readonly name: string } | null;
  readonly types: readonly IntrospectionType[];
}

/** The named type at the bottom of a (possibly list/non-null) type ref. */
export function namedTypeName(ref: IntrospectionTypeRef): string {
  let cur: IntrospectionTypeRef = ref;
  while (cur.kind === "LIST" || cur.kind === "NON_NULL") cur = cur.ofType;
  return cur.name;
}

/** True if a LIST appears anywhere in the type ref. */
export function isListType(ref: IntrospectionTypeRef): boolean {
  let cur: IntrospectionTypeRef = ref;
  while (cur.kind === "LIST" || cur.kind === "NON_NULL") {
    if (cur.kind === "LIST") return true;
    cur = cur.ofType;
  }
  return false;
}

/** True if the outermost wrapper is NON_NULL. */
export function isNonNull(ref: IntrospectionTypeRef): boolean {
  return ref.kind === "NON_NULL";
}

/** Render a GraphQL SDL type ref string, e.g. `[Product!]!`. */
export function renderGraphQLType(ref: IntrospectionTypeRef): string {
  switch (ref.kind) {
    case "NON_NULL":
      return `${renderGraphQLType(ref.ofType)}!`;
    case "LIST":
      return `[${renderGraphQLType(ref.ofType)}]`;
    default:
      return ref.name;
  }
}

/** Introspection meta types (`__Schema`, `__Type`, …) we never generate. */
export function isInternalType(name: string): boolean {
  return name.startsWith("__");
}
