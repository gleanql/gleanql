import type { ArgMap, ArgValue, FieldSelection, OperationIR, SelectionSet } from "./ir.js";

/**
 * Human-authored escape hatch (the brief's `q.query(...)` form).
 *
 * Normal app code relies on compiler extraction; this is for the rare case
 * where an author wants to hand-write an operation. Scalar fields are read as
 * properties; object fields are called with a selection callback; the variables
 * proxy yields `$var` references. Output is printed directly (no identity
 * injection — the author controls the exact selection).
 *
 *   q.query("ProductQuery", { handle: "String!" }, (root, $) => ({
 *     product: root.product({ handle: $.handle }, (p) => ({
 *       title: p.title,
 *       featuredImage: p.featuredImage((image) => ({ url: image.url })),
 *     })),
 *   }));
 */
const FIELD = Symbol("graph.field");
const FIELD_NAME = Symbol("graph.fieldName");

interface FieldMarker {
  readonly [FIELD]: true;
  readonly name: string;
  readonly args?: ArgMap;
  readonly selection?: SelectionSet;
}

type SelectionBuilder = (proxy: FieldProxy) => Record<string, unknown>;
interface FieldAccessor {
  (argsOrCb?: unknown, cb?: SelectionBuilder): FieldMarker;
  [FIELD_NAME]: string;
}
type FieldProxy = Record<string, FieldAccessor>;
type VarProxy = Record<string, ArgValue>;

export function buildQuery(
  name: string,
  variables: Readonly<Record<string, string>>,
  // `root`/`$` are intentionally untyped: this is a schema-free escape hatch.
  build: (root: any, $: any) => Record<string, unknown>,
): OperationIR {
  const selection = toSelectionSet(build(fieldProxy(), varProxy()));
  return {
    kind: "query",
    name,
    variables: Object.entries(variables).map(([n, t]) => ({ name: n, type: t })),
    selection,
  };
}

function fieldProxy(): FieldProxy {
  return new Proxy({} as FieldProxy, {
    get(_t, key: string): FieldAccessor {
      const accessor = ((argsOrCb?: unknown, cb?: SelectionBuilder): FieldMarker => {
        let args: ArgMap | undefined;
        let selectionCb: SelectionBuilder | undefined;
        if (typeof argsOrCb === "function") {
          selectionCb = argsOrCb as SelectionBuilder;
        } else if (argsOrCb && typeof argsOrCb === "object") {
          args = toArgMap(argsOrCb as Record<string, unknown>);
          selectionCb = cb;
        }
        return {
          [FIELD]: true,
          name: key,
          ...(args ? { args } : {}),
          ...(selectionCb ? { selection: toSelectionSet(selectionCb(fieldProxy())) } : {}),
        };
      }) as FieldAccessor;
      accessor[FIELD_NAME] = key;
      return accessor;
    },
  });
}

function varProxy(): VarProxy {
  return new Proxy({} as VarProxy, {
    get(_t, key: string): ArgValue {
      return { kind: "var", name: key };
    },
  });
}

function isFieldMarker(value: unknown): value is FieldMarker {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[FIELD] === true;
}

function toSelectionSet(obj: Record<string, unknown>): SelectionSet {
  const fields: FieldSelection[] = [];
  for (const [responseKey, value] of Object.entries(obj)) {
    if (isFieldMarker(value)) {
      const alias = responseKey !== value.name ? responseKey : undefined;
      fields.push({
        name: value.name,
        ...(alias ? { alias } : {}),
        ...(value.args ? { args: value.args } : {}),
        ...(value.selection ? { selection: value.selection } : {}),
      });
    } else if (typeof value === "function" && FIELD_NAME in value) {
      // Scalar field read as a property (accessor not called).
      const fieldName = (value as FieldAccessor)[FIELD_NAME];
      const alias = responseKey !== fieldName ? responseKey : undefined;
      fields.push({ name: fieldName, ...(alias ? { alias } : {}) });
    }
  }
  return { typeName: "", fields };
}

function toArgMap(obj: Record<string, unknown>): ArgMap {
  return Object.entries(obj).map(([k, v]) => [k, toArgValue(v)] as const);
}

function toArgValue(value: unknown): ArgValue {
  if (isArgValue(value)) return value;
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return { kind: "literal", value };
  }
  if (Array.isArray(value)) return { kind: "list", items: value.map(toArgValue) };
  if (typeof value === "object") {
    return { kind: "object", fields: Object.entries(value).map(([k, v]) => [k, toArgValue(v)] as const) };
  }
  return { kind: "literal", value: null };
}

function isArgValue(value: unknown): value is ArgValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    ["var", "literal", "enum", "list", "object"].includes((value as ArgValue).kind)
  );
}
