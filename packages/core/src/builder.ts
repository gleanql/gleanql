import type {
  ArgMap,
  ArgValue,
  Directive,
  FieldSelection,
  OperationIR,
  OperationKind,
  SelectionSet,
  InlineFragment,
} from "./ir.js";

/**
 * The query builder IR surface (`q`). The compiler emits calls to these helpers
 * rather than GraphQL strings, and there is a human-authored escape hatch that
 * uses the same surface. `q.select` takes a record keyed by *response key*
 * (alias if aliased, else field name); each value carries the real field name.
 */

export interface FieldOptions {
  readonly args?: ArgMap;
  readonly directives?: readonly Directive[];
  readonly selection?: SelectionSet;
  /** Explicit alias. When the record key differs from `name`, that key wins. */
  readonly alias?: string;
}

export type SelectionRecord = Record<string, FieldSelection>;

function buildFields(record: SelectionRecord): FieldSelection[] {
  return Object.entries(record).map(([key, field]) => {
    const alias = field.alias ?? (key !== field.name ? key : undefined);
    return alias ? { ...field, alias } : field;
  });
}

export const q = {
  operation(init: {
    kind: OperationKind;
    name: string;
    variables?: ArgMap | Record<string, string>;
    selection: SelectionSet;
  }): OperationIR {
    const variables = normalizeVariables(init.variables);
    return { kind: init.kind, name: init.name, variables, selection: init.selection };
  },

  query(name: string, selection: SelectionSet, variables?: Record<string, string>): OperationIR {
    return q.operation({ kind: "query", name, selection, variables });
  },

  select(typeName: string, fields: SelectionRecord, inlineFragments?: readonly InlineFragment[]): SelectionSet {
    return { typeName, fields: buildFields(fields), inlineFragments };
  },

  field(name: string, options: FieldOptions = {}): FieldSelection {
    return {
      name,
      ...(options.alias ? { alias: options.alias } : {}),
      ...(options.args ? { args: options.args } : {}),
      ...(options.directives ? { directives: options.directives } : {}),
      ...(options.selection ? { selection: options.selection } : {}),
    };
  },

  scalar(name: string, options: Pick<FieldOptions, "args" | "directives" | "alias"> = {}): FieldSelection {
    return q.field(name, options);
  },

  inlineFragment(onType: string, selection: SelectionSet): InlineFragment {
    return { onType, selection };
  },

  var(name: string): ArgValue {
    return { kind: "var", name };
  },

  literal(value: string | number | boolean | null): ArgValue {
    return { kind: "literal", value };
  },

  enumValue(value: string): ArgValue {
    return { kind: "enum", value };
  },

  list(items: readonly ArgValue[]): ArgValue {
    return { kind: "list", items };
  },

  object(fields: ArgMap): ArgValue {
    return { kind: "object", fields };
  },

  args(map: Record<string, ArgValue>): ArgMap {
    return Object.entries(map);
  },
};

function normalizeVariables(
  variables: ArgMap | Record<string, string> | undefined,
): readonly { name: string; type: string }[] {
  if (!variables) return [];
  if (Array.isArray(variables)) {
    // ArgMap form is not used for variable *definitions*; ignore.
    return [];
  }
  return Object.entries(variables).map(([name, type]) => ({ name, type }));
}
