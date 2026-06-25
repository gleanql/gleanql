import ts from "typescript";

/**
 * Auto-inject the RSC hydrator (no app glue).
 *
 * Each route component must render `<GraphHydrate />` inside its subtree so the
 * graph snapshot rides the RSC flight stream on every navigation (the `Document`
 * shell only renders once). Rather than have apps wrap every page by hand, the
 * build plugin rewrites each discovered route file: a matched route component
 * export `P` is wrapped with `withGraphHydration` from `@gleanql/client/server`.
 *
 * The wrap renames the original declaration to a local and re-exports
 * `export const P = __wgh(<inner>)`. Self-references inside the component resolve
 * to that const (route components don't recurse), so no reference rewriting is
 * needed. Modules marked `"use client"` are skipped (a client page can't host the
 * server hydrator) — `onWarn` is notified.
 *
 * `componentNames` is the set of route-component names attributed to this file by
 * the analyzer. It can include foreign names (child components from other files
 * that also open a graph root — the analyzer reports them under the entry file):
 * names not declared in this file are skipped silently. `onWarn` fires only when a
 * name IS declared here but in an export shape we can't safely wrap.
 *
 * Returns the rewritten source, or `null` to leave the module unchanged.
 */
const WGH = "__graphWithHydration";
const INNER = (name: string) => `__graphInner_${name}`;

export function wrapRouteComponents(
  code: string,
  fileName: string,
  componentNames: ReadonlySet<string>,
  onWarn?: (message: string) => void,
): string | null {
  if (componentNames.size === 0) return null;

  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // "use client" modules can't host a server component — skip and warn.
  const first = sf.statements[0];
  if (
    first &&
    ts.isExpressionStatement(first) &&
    ts.isStringLiteral(first.expression) &&
    first.expression.text === "use client"
  ) {
    onWarn?.(`@gleanql/vite: ${fileName} is a "use client" module — skipping RSC hydrator auto-inject`);
    return null;
  }

  const wrapped: string[] = []; // appended `export const P = __wgh(inner)` lines
  const edits: { start: number; end: number; text: string }[] = [];
  const remaining = new Set(componentNames);

  for (const stmt of sf.statements) {
    if (remaining.size === 0) break;

    // export function P(...) {...}  /  export default function P(...) {...}
    if (ts.isFunctionDeclaration(stmt) && stmt.name && remaining.has(stmt.name.text)) {
      const name = stmt.name.text;
      const isExport = hasModifier(stmt, ts.SyntaxKind.ExportKeyword);
      if (!isExport) continue;
      const isDefault = hasModifier(stmt, ts.SyntaxKind.DefaultKeyword);
      // Strip ONLY the `export`/`default` keywords, then rename the function.
      // `async` is also a modifier and — for a function declaration — follows
      // `export default`, so dropping through the LAST modifier (as a single
      // span) would strip `async` too and leave `await` in a non-async function
      // ("Unexpected reserved word 'await'"). Remove the export/default tokens
      // individually and keep `async` (and any other modifier).
      for (const m of ts.getModifiers(stmt) ?? []) {
        if (m.kind === ts.SyntaxKind.ExportKeyword || m.kind === ts.SyntaxKind.DefaultKeyword) {
          edits.push({ start: m.getStart(sf), end: m.getEnd(), text: "" });
        }
      }
      edits.push({ start: stmt.name.getStart(sf), end: stmt.name.getEnd(), text: INNER(name) });
      wrapped.push(
        isDefault
          ? `export default ${WGH}(${INNER(name)});`
          : `export const ${name} = ${WGH}(${INNER(name)});`,
      );
      remaining.delete(name);
      continue;
    }

    // export const P = ...  (arrow/function-expression components)
    if (ts.isVariableStatement(stmt) && hasModifier(stmt, ts.SyntaxKind.ExportKeyword)) {
      const decls = stmt.declarationList.declarations;
      const matched = decls.filter((d) => ts.isIdentifier(d.name) && remaining.has(d.name.text));
      if (matched.length === 0) continue;
      if (decls.length !== 1) {
        // Mixed `export const A = …, B = …` — too ambiguous to split safely.
        for (const d of matched) {
          if (ts.isIdentifier(d.name)) onWarn?.(unsupported(fileName, d.name.text));
        }
        continue;
      }
      const decl = matched[0]!;
      const name = (decl.name as ts.Identifier).text;
      const modsEnd = lastModifierEnd(stmt, sf);
      edits.push({ start: stmt.getStart(sf), end: modsEnd, text: "" }); // drop `export`
      edits.push({ start: decl.name.getStart(sf), end: decl.name.getEnd(), text: INNER(name) });
      wrapped.push(`export const ${name} = ${WGH}(${INNER(name)});`);
      remaining.delete(name);
      continue;
    }

    // export { L as P }  — wrap the local L, re-export as P (skip when L === P).
    if (ts.isExportDeclaration(stmt) && stmt.exportClause && ts.isNamedExports(stmt.exportClause) && !stmt.moduleSpecifier) {
      const kept: string[] = [];
      let touched = false;
      for (const spec of stmt.exportClause.elements) {
        const exportName = spec.name.text;
        const localName = spec.propertyName?.text ?? spec.name.text;
        if (remaining.has(exportName) && localName !== exportName) {
          wrapped.push(`export const ${exportName} = ${WGH}(${localName});`);
          remaining.delete(exportName);
          touched = true;
        } else {
          if (remaining.has(exportName)) onWarn?.(unsupported(fileName, exportName));
          kept.push(spec.propertyName ? `${spec.propertyName.text} as ${spec.name.text}` : spec.name.text);
        }
      }
      if (touched) {
        edits.push({
          start: stmt.getStart(sf),
          end: stmt.getEnd(),
          text: kept.length ? `export { ${kept.join(", ")} };` : "",
        });
      }
      continue;
    }
  }

  // `remaining` now holds names not declared in this file (foreign child
  // components the analyzer attributed to the entry file) — skip them silently.
  if (wrapped.length === 0) return null;

  // Apply edits back-to-front so offsets stay valid.
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  return (
    `import { withGraphHydration as ${WGH} } from "@gleanql/client/server";\n` +
    out +
    `\n${wrapped.join("\n")}\n`
  );
}

function unsupported(fileName: string, name: string): string {
  return `@gleanql/vite: could not auto-inject RSC hydrator for route component "${name}" in ${fileName} (unsupported export form) — render <GraphHydrate /> manually`;
}

function hasModifier(node: ts.HasModifiers, kind: ts.SyntaxKind): boolean {
  return !!ts.getModifiers(node)?.some((m) => m.kind === kind);
}

/** End offset of the last modifier (so we can drop `export`/`default` keywords). */
function lastModifierEnd(node: ts.HasModifiers & ts.Node, sf: ts.SourceFile): number {
  const mods = ts.getModifiers(node);
  const last = mods?.at(-1);
  return last ? last.getEnd() : node.getStart(sf);
}
