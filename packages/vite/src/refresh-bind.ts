import ts from "typescript";

/**
 * Bind `refresh()` to its calling component (all frameworks).
 *
 * An island writes a bare `refresh()` to refetch its own fields — no hand-written
 * selection. The runtime can't know which component called it, so at build time we
 * rewrite each zero-arg `refresh()` (imported from `@gleanql/client/client`) to
 * `refresh({ component: "<EnclosingComponent>" })`. The runtime then prunes the
 * page operation to that component's compiled read-map.
 *
 * Only bare `refresh()` calls inside a named function are touched — `refresh("Op")`
 * or `refresh(...)` with args, and calls outside a component, are left alone (they
 * fall back to a whole-operation refetch). Returns the rewritten source, or `null`.
 */
export function bindComponentRefresh(code: string, fileName: string): string | null {
  // Cheap pre-check: skip files that can't contain a bound refresh call.
  if (!code.includes("refresh") || !code.includes("@gleanql/client/client")) return null;

  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const local = importedRefreshName(sf);
  if (!local) return null;

  const edits: { pos: number; text: string }[] = [];
  const visit = (node: ts.Node, component: string | undefined): void => {
    const name = componentName(node) ?? component;
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 0 &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === local &&
      component // only inside a named component
    ) {
      edits.push({ pos: node.getEnd() - 1, text: `{ component: ${JSON.stringify(component)} }` });
    }
    ts.forEachChild(node, (child) => visit(child, name));
  };
  visit(sf, undefined);
  if (edits.length === 0) return null;

  edits.sort((a, b) => b.pos - a.pos);
  let out = code;
  for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
  return out;
}

/** The local name `refresh` is imported as from `@gleanql/client/client`, if any. */
function importedRefreshName(sf: ts.SourceFile): string | undefined {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== "@gleanql/client/client") continue;
    const named = stmt.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        if ((el.propertyName?.text ?? el.name.text) === "refresh") return el.name.text;
      }
    }
  }
  return undefined;
}

/** The component name a node *introduces* as a scope (a named function/arrow component), else undefined. */
function componentName(node: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }
  return undefined;
}
