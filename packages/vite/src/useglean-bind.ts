import ts from "typescript";

/**
 * Bind `useGlean()` to its calling component (read-masking only).
 *
 * The masking check needs to know WHICH component performed a read, and the
 * runtime can't see the caller — so at build time each bare `useGlean()`
 * (imported from `@gleanql/client/client`) inside a named function is rewritten
 * to `useGlean("<EnclosingComponent>")`, the same syntactic rule the compiler
 * uses for read-map attribution. Calls that already pass an argument are left
 * alone. Returns the rewritten source, or `null`.
 */
export function bindUseGleanComponent(code: string, fileName: string): string | null {
  // Cheap pre-check: skip files that can't contain a bindable call.
  if (!code.includes("useGlean") || !code.includes("@gleanql/client/client")) return null;

  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const local = importedName(sf, "useGlean");
  if (!local) return null;

  const edits: { pos: number; text: string }[] = [];
  const visit = (node: ts.Node, component: string | undefined): void => {
    const name = componentName(node) ?? component;
    if (
      ts.isCallExpression(node) &&
      node.arguments.length === 0 &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === local &&
      component
    ) {
      edits.push({ pos: node.getEnd() - 1, text: JSON.stringify(component) });
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

/** The local name `target` is imported as from `@gleanql/client/client`, if any. */
function importedName(sf: ts.SourceFile, target: string): string | undefined {
  for (const stmt of sf.statements) {
    if (!ts.isImportDeclaration(stmt) || !ts.isStringLiteral(stmt.moduleSpecifier)) continue;
    if (stmt.moduleSpecifier.text !== "@gleanql/client/client") continue;
    const named = stmt.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        if ((el.propertyName?.text ?? el.name.text) === target) return el.name.text;
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
