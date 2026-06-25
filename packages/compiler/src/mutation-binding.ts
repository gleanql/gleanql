import type ts from "typescript";
import type { OperationKind } from "@gleanql/core";
import { isFunctionLike, type AstFacade } from "./ast-facade.js";

/**
 * Selector-hook call-site discovery, shared by the analyzer and the build-time
 * binding transform so both agree on the operation name for a given call.
 *
 * Two hooks compile a call-site selector into a named operation, gqty-style:
 *
 *   const [add]        = useMutation((m, vars) => m.cartLinesAdd(vars).cart.totalQuantity);
 *   const { data }     = useSubscription((s, vars) => s.productViews(vars));
 *
 * The selector never runs at runtime (Glean is compile-time), so the analyzer
 * compiles it into a named operation (`kind:"mutation"` / `kind:"subscription"`)
 * and the binding transform injects that same name into the call. Naming is purely
 * SYNTACTIC — the enclosing component name plus the first root field the selector
 * touches — so the analyzer (which has the schema) and the transform (which doesn't)
 * derive identical names from the same AST, in document order.
 */

/**
 * The built-in selector callees that compile to operations, and the op kind each
 * produces. These are the client hooks. A framework's SERVER mutation primitive
 * (e.g. `mutate(...)` in a server action) is configured per-build via the vite
 * plugin's `serverMutate` option, NOT hardcoded here — see `selectorHooks()`.
 */
export const SELECTOR_HOOKS: Readonly<Record<string, OperationKind>> = {
  useMutation: "mutation",
  useSubscription: "subscription",
};

/**
 * The effective selector callees for a build: the built-in hooks plus an optional
 * framework server-mutate callee (a mutation). Keeping this one function as the
 * single source of truth means the analyzer, the binding transform, and file
 * discovery all agree on which callees compile.
 */
export function selectorHooks(serverMutate?: string): Readonly<Record<string, OperationKind>> {
  return serverMutate ? { ...SELECTOR_HOOKS, [serverMutate]: "mutation" } : SELECTOR_HOOKS;
}

export interface SelectorHookSite {
  /** Which hook this is (`"mutation"` | `"subscription"`). */
  readonly kind: OperationKind;
  readonly call: ts.CallExpression;
  readonly selector: ts.ArrowFunction | ts.FunctionExpression;
  /** The selector's accessor parameter name (`m`/`s` in `(m, vars) => ...`). */
  readonly accessorName: string | undefined;
  /** The selector's variables parameter name (`vars`), if present. */
  readonly varsName: string | undefined;
  /** Enclosing named component/function, if any. */
  readonly component: string | undefined;
  /** Stable operation name: `${component}_${field}` (with an index for repeats). */
  readonly opName: string;
}

/** Back-compat alias — a mutation site is just a selector-hook site of kind `"mutation"`. */
export type UseMutationSite = SelectorHookSite;

/**
 * Find every selector-hook call (`useMutation`/`useSubscription`) under `root`, in
 * document order, each tagged with its kind and the operation name it compiles to.
 * Detection is by the literal callee name (the same lexical convention `useGlean`
 * uses), so it works across the `typescript` and tsgo engines without a checker.
 */
export function findSelectorHookSites(
  root: ts.Node,
  ast: AstFacade,
  hooks: Readonly<Record<string, OperationKind>> = SELECTOR_HOOKS,
): SelectorHookSite[] {
  const sites: SelectorHookSite[] = [];
  const counts = new Map<string, number>();

  const visit = (node: ts.Node, component: string | undefined): void => {
    const here = componentNameOf(node, ast) ?? component;

    if (ast.isCallExpression(node) && ast.isIdentifier(node.expression)) {
      const kind = hooks[node.expression.text];
      if (kind) {
        const selector = node.arguments[0];
        if (selector && isFunctionLike(ast, selector)) {
          const accessorName = paramName(selector.parameters[0], ast);
          const field = accessorName ? firstRootField(selector, accessorName, ast) : undefined;
          if (field) {
            const base = here ? `${here}_${field}` : field;
            const n = counts.get(base) ?? 0;
            counts.set(base, n + 1);
            sites.push({
              kind,
              call: node,
              selector,
              accessorName,
              varsName: paramName(selector.parameters[1], ast),
              component: here,
              opName: n === 0 ? base : `${base}_${n + 1}`,
            });
          }
        }
      }
    }

    ast.forEachChild(node, (child) => visit(child, here));
  };
  visit(root, undefined);
  return sites;
}

/** Just the `useMutation` sites (back-compat). */
export function findUseMutationSites(root: ts.Node, ast: AstFacade): UseMutationSite[] {
  return findSelectorHookSites(root, ast).filter((s) => s.kind === "mutation");
}

/** The component name a node *introduces* as a scope (named function / arrow-const). */
function componentNameOf(node: ts.Node, ast: AstFacade): string | undefined {
  if (ast.isFunctionDeclaration(node) && node.name && ast.isIdentifier(node.name)) return node.name.text;
  if (
    ast.isVariableDeclaration(node) &&
    ast.isIdentifier(node.name) &&
    node.initializer &&
    isFunctionLike(ast, node.initializer)
  ) {
    return node.name.text;
  }
  return undefined;
}

function paramName(param: ts.ParameterDeclaration | undefined, ast: AstFacade): string | undefined {
  return param && ast.isIdentifier(param.name) ? param.name.text : undefined;
}

/** The first `accessor.<field>(...)` call the selector makes (the operation root). */
function firstRootField(
  selector: ts.ArrowFunction | ts.FunctionExpression,
  accessorName: string,
  ast: AstFacade,
): string | undefined {
  let found: string | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ast.isCallExpression(node) &&
      ast.isPropertyAccessExpression(node.expression) &&
      ast.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === accessorName
    ) {
      found = node.expression.name.text;
      return;
    }
    ast.forEachChild(node, visit);
  };
  visit(selector.body); // body only — params can't contain the root call
  return found;
}
