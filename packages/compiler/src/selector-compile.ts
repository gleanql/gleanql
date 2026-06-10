import type ts from "typescript";
import {
  type OperationArtifact,
  type OperationIR,
  type ArgMap,
  type ArgValue,
  type SelectionSet,
  type SchemaModel,
  canonicalArgs,
  mergeSelectionSets,
  printOperation,
  hashDocument,
} from "@gleanql/core";
import { MutableSelection } from "./mutable.js";
import type { AstFacade } from "./ast-facade.js";
import type { SelectorHookSite } from "./mutation-binding.js";

/**
 * Compile a `useMutation`/`useSubscription` selector into a standalone operation.
 *
 * Unlike the route walk — which threads component scope, JSX and read-maps through
 * the Analyzer's shared state — a selector is a self-contained little expression:
 * `(m, vars) => m.cartLinesAdd(vars).cart.totalQuantity`. It roots at the schema's
 * mutation/subscription type, the first `m.<field>(args)` call is the operation root
 * (its args lift to operation variables), and the chain after it is the result
 * selection. So this lives in its own module, taking only the pieces it needs from
 * the analyzer via {@link SelectorCompileContext} rather than reaching into `this`.
 */
export interface SelectorCompileContext {
  readonly schema: SchemaModel;
  readonly ast: AstFacade;
  readonly sf: ts.SourceFile;
  /** Parse an object-literal arg node into an `ArgMap` (literal args on a nested field). */
  parseArgs(node: ts.Expression | undefined): ArgMap | undefined;
  /** The declared-arg name a root-call object-literal property targets. */
  argEntry(prop: ts.ObjectLiteralElementLike): { argName?: string };
  /** Compute the artifact's field/connection stats from its selection. */
  computeStats(selection: SelectionSet): OperationArtifact["stats"];
}

/** A value flowing through a selector (the mutation/subscription root, or a result field). */
interface SelectorValue {
  readonly typeName: string;
  readonly sel: MutableSelection;
  readonly isList: boolean;
  /** True only for the synthetic root accessor (`m`/`s`). */
  readonly isRoot?: boolean;
}

/**
 * Compile one selector-hook call site into a `kind:"mutation"`/`kind:"subscription"`
 * operation, reusing the same `MutableSelection` + merger machinery as queries (so
 * nested entities get identity injected and normalize in place). Returns `undefined`
 * when nothing compiled (no accessor param, or an empty selection).
 */
export function compileSelectorOperation(
  site: SelectorHookSite,
  rootType: string,
  ctx: SelectorCompileContext,
): OperationArtifact | undefined {
  if (!site.accessorName) return undefined;
  const { schema, ast, sf } = ctx;
  const rootSel = new MutableSelection(rootType);
  const vars: Array<{ name: string; type: string }> = [];
  const factory: Array<readonly [string, string]> = [];
  const addVar = (name: string, type: string, valueSource: string): void => {
    if (vars.some((v) => v.name === name)) return;
    vars.push({ name, type });
    factory.push([name, valueSource]);
  };
  const locals = new Map<string, SelectorValue>();

  const root: SelectorValue = { typeName: rootType, sel: rootSel, isList: false, isRoot: true };

  const evalSelector = (node: ts.Node): SelectorValue | undefined => {
    if (ast.isParenthesizedExpression(node) || ast.isNonNullExpression(node)) {
      return evalSelector(node.expression);
    }
    if (ast.isIdentifier(node)) {
      if (node.text === site.accessorName) return root;
      return locals.get(node.text);
    }
    if (ast.isPropertyAccessExpression(node)) {
      const base = evalSelector(node.expression);
      if (!base || node.name.text === "__typename") return undefined;
      return openField(ctx, base, node.name.text, undefined);
    }
    if (ast.isCallExpression(node)) {
      const callee = node.expression;
      if (!ast.isPropertyAccessExpression(callee)) return undefined;
      const base = evalSelector(callee.expression);
      if (!base) return undefined;
      const fieldName = callee.name.text;
      if (base.isRoot) {
        return openRootCall(ctx, rootSel, rootType, fieldName, node.arguments[0], site.varsName, addVar);
      }
      return openField(ctx, base, fieldName, ctx.parseArgs(node.arguments[0]));
    }
    // A container return — `return [t.id, t.title]` or `return { id: t.id, ... }` — isn't a
    // single graph value, but each element/property IS a read to fold; walk them so a
    // selector can pull several fields back from one mutation (e.g. to splice the new
    // entity into a list root afterward).
    if (ast.isArrayLiteralExpression(node)) {
      for (const el of node.elements) evalSelector(el);
      return undefined;
    }
    if (ast.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (ast.isPropertyAssignment(prop)) evalSelector(prop.initializer);
        else if (ast.isShorthandPropertyAssignment(prop)) evalSelector(prop.name);
        else if (ast.isSpreadAssignment(prop)) evalSelector(prop.expression);
      }
      return undefined;
    }
    return undefined;
  };

  const body = site.selector.body;
  if (ast.isBlock(body)) {
    for (const stmt of body.statements) {
      if (ast.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (ast.isIdentifier(decl.name) && decl.initializer) {
            const value = evalSelector(decl.initializer);
            if (value) locals.set(decl.name.text, value);
          }
        }
      } else if (ast.isReturnStatement(stmt)) {
        if (stmt.expression) evalSelector(stmt.expression);
      } else if (ast.isExpressionStatement(stmt)) {
        evalSelector(stmt.expression);
      }
    }
  } else {
    evalSelector(body); // arrow expression body
  }

  const selection = mergeSelectionSets([rootSel.toIR()], schema, { isRoot: true });
  if (selection.fields.length === 0) return undefined; // nothing compiled

  const ir: OperationIR = { kind: site.kind, name: site.opName, variables: vars, selection };
  const document = printOperation(ir);
  return {
    name: site.opName,
    kind: site.kind,
    document,
    hash: hashDocument(document),
    variablesFactory: { exportName: `get${site.opName}Variables`, source: selectorVariablesFactory(site.opName, factory) },
    readMap: {},
    selection: ir.selection,
    variableDefs: ir.variables,
    source: sf.fileName,
    stats: ctx.computeStats(ir.selection),
  };
}

/** The operation root call `m.field(args)`: lift its args to variables, open the field. */
function openRootCall(
  ctx: SelectorCompileContext,
  rootSel: MutableSelection,
  rootType: string,
  fieldName: string,
  argExpr: ts.Expression | undefined,
  varsName: string | undefined,
  addVar: (name: string, type: string, valueSource: string) => void,
): SelectorValue | undefined {
  const { schema, ast } = ctx;
  const def = schema.getField(rootType, fieldName);
  if (!def) return undefined;
  const argMap: Array<readonly [string, ArgValue]> = [];

  // The variables factory receives the runtime `vars` object AS `ctx`, so every
  // operation variable is fed by the GraphQL arg's own name (`ctx.<arg>`). The two
  // selector forms differ only in WHICH args are lifted; the selector's value
  // expressions are compile-time only and never run.
  if (argExpr && ast.isIdentifier(argExpr) && argExpr.text === varsName) {
    // Whole-`vars` pass-through (`m.field(vars)`): lift every declared arg.
    for (const a of def.args ?? []) {
      addVar(a.name, a.type, `ctx.${a.name}`);
      argMap.push([a.name, { kind: "var", name: a.name }]);
    }
  } else if (argExpr && ast.isObjectLiteralExpression(argExpr)) {
    // Explicit arg object (`m.field({ cartId, lines })`): lift the named args, each
    // fed from `vars` by the same key.
    for (const prop of argExpr.properties) {
      const { argName } = ctx.argEntry(prop);
      if (!argName) continue;
      const argType = def.args?.find((a) => a.name === argName)?.type ?? "String";
      addVar(argName, argType, `ctx.${argName}`);
      argMap.push([argName, { kind: "var", name: argName }]);
    }
  }

  // A mutation/subscription root may return a scalar (`removeTodo(id): ID`,
  // `clearCompleted: Int`): emit it as a leaf field with no sub-selection, and there's
  // nothing further to chain off it.
  return finishField(ctx, rootSel, def.type, fieldName, argMap, def.list);
}

/** Open a non-root field on a selector result value (builds selection only, no read-map). */
function openField(
  ctx: SelectorCompileContext,
  base: SelectorValue,
  fieldName: string,
  args: ArgMap | undefined,
): SelectorValue | undefined {
  const def = ctx.schema.getField(base.typeName, fieldName);
  if (!def) return undefined;
  return finishField(ctx, base.sel, def.type, fieldName, args, def.list);
}

/**
 * The shared tail of opening any selector field: add it to the selection (leaf
 * fields get no sub-selection) and return the value to keep chaining off — or
 * `undefined` when the chain ends at a leaf.
 */
function finishField(
  ctx: SelectorCompileContext,
  sel: MutableSelection,
  fieldType: string,
  fieldName: string,
  args: ArgMap | undefined,
  list: boolean | undefined,
): SelectorValue | undefined {
  const isLeaf = ctx.schema.isLeaf(fieldType);
  const key = canonicalArgs(args);
  const field = sel.field(fieldName, key, () => ({
    name: fieldName,
    key,
    ...(args ? { args } : {}),
    child: isLeaf ? undefined : new MutableSelection(fieldType),
  }));
  if (isLeaf) return undefined;
  return { typeName: fieldType, sel: field.child!, isList: list ?? false };
}

/**
 * The variables factory for a selector operation: it receives the runtime `vars` as
 * `ctx` and returns the GraphQL variables. For the whole-`vars` form this is an
 * identity over the declared args; for an explicit arg object each entry is the
 * captured `vars.*` source.
 */
function selectorVariablesFactory(opName: string, entries: ReadonlyArray<readonly [string, string]>): string {
  const exportName = `get${opName}Variables`;
  const lines = entries.map(([name, source]) => `    ${name}: ${source},`);
  const body = entries.length > 0 ? `  return {\n${lines.join("\n")}\n  };` : "  return {};";
  return `export function ${exportName}(ctx) {\n${body}\n}\n`;
}
