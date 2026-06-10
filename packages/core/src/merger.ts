import type { FieldSelection, InlineFragment, OperationIR, SelectionSet } from "./ir.js";
import { canonicalArgs, canonicalDirectives, argAliasSuffix } from "./canonical.js";
import type { SchemaModel } from "./schema.js";

/**
 * Selection merging + normalization.
 *
 * Given any number of selection-set contributions over the same GraphQL type
 * (e.g. one per component read, or per dynamic-component candidate), produce a
 * single canonical selection set:
 *
 *  - Fields with equal (name, canonical args, directives) dedupe and their
 *    sub-selections merge recursively.
 *  - Fields sharing a name but differing in args/directives coexist with
 *    generated aliases (`products_first12` / `products_first24`).
 *  - Identity fields are injected per policy: every non-root object selection
 *    gets `__typename`; types exposing `id` also get `id`.
 *  - Output order is stable: `__typename`, then `id`, then fields in
 *    first-seen order. This makes golden output deterministic.
 *
 * NOTE ON IDENTITY POLICY: we always inject `__typename` for object selections,
 * including pure-scalar leaf objects like `MoneyV2`. The brief's prose
 * ("include __typename when needed for existence/discrimination") and its
 * page-3 example agree with this, while one later snippet omits `__typename`
 * on `MoneyV2` — that snippet is internally inconsistent (it keeps it on the
 * structurally identical `Image`). We choose the consistent rule.
 */

interface MergeContext {
  readonly schema: SchemaModel;
}

export function mergeSelectionSets(
  sets: readonly SelectionSet[],
  schema: SchemaModel,
  options: { isRoot?: boolean } = {},
): SelectionSet {
  if (sets.length === 0) throw new Error("mergeSelectionSets: no sets to merge");
  const typeName = sets[0]!.typeName;
  return mergeOnType(typeName, sets, { schema }, options.isRoot ?? false);
}

export function mergeOperations(
  name: string,
  operations: readonly OperationIR[],
  schema: SchemaModel,
): OperationIR {
  if (operations.length === 0) throw new Error("mergeOperations: nothing to merge");
  const kind = operations[0]!.kind;
  const variables = dedupeVariables(operations.flatMap((o) => o.variables));
  const selection = mergeSelectionSets(
    operations.map((o) => o.selection),
    schema,
    { isRoot: true },
  );
  return { kind, name, variables, selection };
}

function mergeOnType(
  typeName: string,
  sets: readonly SelectionSet[],
  ctx: MergeContext,
  isRoot: boolean,
): SelectionSet {
  const allFields = sets.flatMap((s) => s.fields);
  const allFragments = sets.flatMap((s) => s.inlineFragments ?? []);

  const mergedFields = mergeFields(typeName, allFields, ctx);
  const ordered = orderFields(typeName, mergedFields, ctx, isRoot);
  const inlineFragments = mergeInlineFragments(allFragments, ctx);

  return {
    typeName,
    fields: ordered,
    ...(inlineFragments.length > 0 ? { inlineFragments } : {}),
  };
}

interface FieldGroup {
  readonly name: string;
  readonly argsKey: string;
  readonly firstSeen: number;
  readonly contributions: FieldSelection[];
}

function mergeFields(parentType: string, fields: readonly FieldSelection[], ctx: MergeContext): FieldSelection[] {
  // Group by (name + canonical args + directives).
  const groups = new Map<string, FieldGroup>();
  fields.forEach((field, index) => {
    const argsKey = `${canonicalArgs(field.args)}|${canonicalDirectives(field.directives)}`;
    const key = `${field.name}::${argsKey}`;
    const existing = groups.get(key);
    if (existing) {
      existing.contributions.push(field);
    } else {
      groups.set(key, { name: field.name, argsKey, firstSeen: index, contributions: [field] });
    }
  });

  // Group by field name to decide aliasing among arg-variants.
  const byName = new Map<string, FieldGroup[]>();
  for (const group of groups.values()) {
    const list = byName.get(group.name);
    if (list) list.push(group);
    else byName.set(group.name, [group]);
  }

  const result: FieldSelection[] = [];
  for (const group of groups.values()) {
    // A field name with multiple arg/directive variants can't share one response
    // key, so each variant with args gets an arg-derived alias. The no-args
    // variant (argsKey starts with the `|` separator) keeps the bare field name.
    const variants = byName.get(group.name)!;
    const hasArgs = !group.argsKey.startsWith("|");
    const needsAlias = variants.length > 1 && hasArgs;
    const alias = needsAlias ? `${group.name}_${argAliasSuffix(group.contributions[0]!.args)}` : undefined;

    const childType = resolveFieldType(parentType, group.name, ctx);
    const childSets = group.contributions
      .map((c) => c.selection)
      .filter((s): s is SelectionSet => !!s);

    let selection: SelectionSet | undefined;
    if (childSets.length > 0) {
      const childTypeName = childType ?? childSets[0]!.typeName;
      selection = mergeOnType(childTypeName, childSets, ctx, false);
    }

    const base = group.contributions[0]!;
    result.push({
      name: group.name,
      ...(alias ? { alias } : {}),
      ...(base.args ? { args: base.args } : {}),
      ...(base.directives ? { directives: base.directives } : {}),
      ...(selection ? { selection } : {}),
      _order: group.firstSeen,
    } as FieldSelection & { _order: number });
  }
  return result;
}

function resolveFieldType(parentType: string, fieldName: string, ctx: MergeContext): string | undefined {
  return ctx.schema.getField(parentType, fieldName)?.type;
}

function mergeInlineFragments(fragments: readonly InlineFragment[], ctx: MergeContext): InlineFragment[] {
  const byType = new Map<string, SelectionSet[]>();
  const order: string[] = [];
  for (const frag of fragments) {
    const list = byType.get(frag.onType);
    if (list) {
      list.push(frag.selection);
    } else {
      byType.set(frag.onType, [frag.selection]);
      order.push(frag.onType);
    }
  }
  return order.map((onType) => ({
    onType,
    selection: mergeOnType(onType, byType.get(onType)!, ctx, false),
  }));
}

function orderFields(
  typeName: string,
  fields: readonly FieldSelection[],
  ctx: MergeContext,
  isRoot: boolean,
): FieldSelection[] {
  const keyFields = ctx.schema.keyFields(typeName);
  const identityNames = new Set(["__typename", ...keyFields]);
  const stripped = fields
    .map((f) => {
      const { _order, ...rest } = f as FieldSelection & { _order?: number };
      return { field: rest as FieldSelection, order: _order ?? 0 };
    })
    .filter((f) => !identityNames.has(f.field.name));

  stripped.sort((a, b) => a.order - b.order);
  const userFields = stripped.map((s) => s.field);

  if (isRoot) return userFields;

  const identity: FieldSelection[] = [];
  if (ctx.schema.isObjectLike(typeName)) {
    identity.push({ name: "__typename" });
    // Auto-select the type's key field(s) so results can be normalized.
    for (const key of keyFields) identity.push({ name: key });
  }
  return [...identity, ...userFields];
}

function dedupeVariables(
  variables: readonly { name: string; type: string }[],
): { name: string; type: string }[] {
  const seen = new Map<string, { name: string; type: string }>();
  for (const v of variables) {
    if (!seen.has(v.name)) seen.set(v.name, v);
  }
  return [...seen.values()];
}
