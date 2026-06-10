/**
 * Minimal schema model.
 *
 * The compiler needs enough schema knowledge to: resolve the GraphQL type of a
 * field, know whether a type carries identity (`id`), distinguish
 * scalar/object/list/union fields, and validate root calls. This model is
 * deliberately small and hand-authorable; an introspection-driven generator
 * can later produce the same shape.
 */

export type TypeKind = "scalar" | "object" | "interface" | "union" | "enum" | "input";

export interface FieldArgDef {
  readonly name: string;
  /** GraphQL type ref, e.g. `String!`, `Int`, `ImageTransformInput`. */
  readonly type: string;
}

export interface FieldDef {
  readonly name: string;
  /** Named GraphQL type this field resolves to (list/nullability stripped). */
  readonly type: string;
  readonly list?: boolean;
  readonly nonNull?: boolean;
  readonly args?: readonly FieldArgDef[];
}

export interface TypeDef {
  readonly name: string;
  readonly kind: TypeKind;
  /** For object/interface types. */
  readonly fields?: Record<string, FieldDef>;
  /** For unions: the member type names. */
  readonly possibleTypes?: readonly string[];
  /**
   * Identifying field(s) for normalization, overriding the default `["id"]`.
   * Use for types whose identity is some other field (`["slug"]`, `["sku"]`) or
   * a composite (`["shopId", "handle"]`). `[]` marks a type as never-normalized
   * (always embedded under its parent).
   */
  readonly keys?: readonly string[];
}

export interface SchemaModelInit {
  readonly queryType?: string;
  readonly mutationType?: string;
  readonly subscriptionType?: string;
  readonly types: readonly TypeDef[];
}

export class SchemaModel {
  readonly queryType: string;
  readonly mutationType: string | undefined;
  readonly subscriptionType: string | undefined;
  private readonly types: Map<string, TypeDef>;

  constructor(init: SchemaModelInit) {
    this.queryType = init.queryType ?? "Query";
    this.mutationType = init.mutationType;
    this.subscriptionType = init.subscriptionType;
    this.types = new Map(init.types.map((t) => [t.name, t]));
  }

  getType(name: string): TypeDef | undefined {
    return this.types.get(name);
  }

  getField(typeName: string, fieldName: string): FieldDef | undefined {
    return this.types.get(typeName)?.fields?.[fieldName];
  }

  /** A type "has identity" if it exposes a scalar `id` field. */
  hasId(typeName: string): boolean {
    const id = this.getField(typeName, "id");
    return !!id && this.isLeaf(id.type);
  }

  /**
   * The fields that identify a type for normalization: an explicit `keys`
   * override, else `["id"]` when the type exposes one, else `[]` (id-less).
   * Drives both the compiler (which fields to auto-select) and the runtime
   * (how to key the normalized record).
   */
  keyFields(typeName: string): readonly string[] {
    const t = this.types.get(typeName);
    if (t?.keys) return t.keys;
    return this.hasId(typeName) ? ["id"] : [];
  }

  /** The identity value from an object's key fields, or undefined if id-less / incomplete. */
  identityOf(typeName: string, obj: Record<string, unknown>): string | undefined {
    const keys = this.keyFields(typeName);
    if (keys.length === 0) return undefined;
    const parts: string[] = [];
    for (const k of keys) {
      const v = obj[k];
      if (v == null) return undefined;
      parts.push(String(v));
    }
    return parts.join(":");
  }

  isObjectLike(typeName: string): boolean {
    const t = this.types.get(typeName);
    return t?.kind === "object" || t?.kind === "interface" || t?.kind === "union";
  }

  isUnionOrInterface(typeName: string): boolean {
    const t = this.types.get(typeName);
    return t?.kind === "union" || t?.kind === "interface";
  }

  /** Leaf = scalar or enum (no sub-selection). */
  isLeaf(typeName: string): boolean {
    const t = this.types.get(typeName);
    return t?.kind === "scalar" || t?.kind === "enum";
  }

  possibleTypes(typeName: string): readonly string[] {
    const t = this.types.get(typeName);
    if (t?.kind === "union") return t.possibleTypes ?? [];
    return [typeName];
  }

  getRootField(name: string): FieldDef | undefined {
    return this.getField(this.queryType, name);
  }
}

export function defineSchema(init: SchemaModelInit): SchemaModel {
  return new SchemaModel(init);
}
