/**
 * EXPERIMENTAL tsgo backend. Drives the same {@link analyzeFile} walker over
 * tsgo's (`@typescript/native-preview`) AST + checker instead of the in-process
 * `typescript` engine, via the engine-agnostic {@link AstFacade} + backend seam.
 *
 * The dependency is optional and dynamically imported; its `./unstable` API is
 * pre-release and types are loose here on purpose (`any` at the boundary). The
 * AST node shapes match `typescript` structurally, so they masquerade as `ts.*`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type ts from "typescript";
import type { SchemaModel } from "@gleanql/core";
import type { BackendOptions, GraphCompilerBackend } from "../backend.js";
import type { AstFacade } from "../ast-facade.js";
import { analyzeFile, type AnalyzeResult } from "../analyzer.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

interface TsgoSession {
  readonly project: Any;
  readonly ast: Any;
  readonly flags: { TypeFlags: Any; SymbolFlags: Any };
  dispose(): void;
}

async function boot(options: BackendOptions): Promise<TsgoSession> {
  const sync: Any = await import("@typescript/native-preview/unstable/sync");
  const ast: Any = await import("@typescript/native-preview/unstable/ast");

  const support = options.supportDir;
  const tsconfig = {
    compilerOptions: {
      strict: false,
      noEmit: true,
      jsx: "preserve",
      module: "esnext",
      target: "es2022",
      moduleResolution: "bundler",
      skipLibCheck: true,
      baseUrl: options.baseUrl ?? support,
      paths: {
        "~/graph": [path.join(support, "graph.ts")],
        "~/graph/schema": [path.join(support, "schema.ts")],
        ...(options.paths ?? {}),
      },
    },
    files: [...options.fileNames, path.join(support, "graph.ts"), path.join(support, "schema.ts")],
  };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-tsgo-"));
  fs.writeFileSync(path.join(dir, "tsconfig.json"), JSON.stringify(tsconfig));
  const api = new sync.API({ cwd: dir });
  const snapshot = api.updateSnapshot({ openProject: path.join(dir, "tsconfig.json") });
  const project = snapshot.getProjects()[0];
  if (!project) {
    api.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
    throw new Error("@gleanql/compiler tsgo: no project opened for the synthesized tsconfig");
  }
  return {
    project,
    ast,
    flags: { TypeFlags: sync.TypeFlags, SymbolFlags: sync.SymbolFlags },
    dispose: () => {
      try { api.close?.(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    },
  };
}

/** Build the AST facade from tsgo's `./unstable/ast` module. */
function makeFacade(ast: Any): AstFacade {
  const sk = ast.SyntaxKind;
  const startOf = (node: Any, sf: Any): number => ast.getTokenPosOfNode(node, sf);
  const textOf = (node: Any, sf: Any): string => sf.text.substring(startOf(node, sf), node.end);

  const facade = {
    isIdentifier: ast.isIdentifier,
    isBlock: ast.isBlock,
    isVariableStatement: ast.isVariableStatement,
    isVariableDeclaration: ast.isVariableDeclaration,
    isIfStatement: ast.isIfStatement,
    isReturnStatement: ast.isReturnStatement,
    isExpressionStatement: ast.isExpressionStatement,
    isCallExpression: ast.isCallExpression,
    isPropertyAccessExpression: ast.isPropertyAccessExpression,
    isElementAccessExpression: ast.isElementAccessExpression,
    isObjectLiteralExpression: ast.isObjectLiteralExpression,
    isArrayLiteralExpression: ast.isArrayLiteralExpression,
    isConditionalExpression: ast.isConditionalExpression,
    isParenthesizedExpression: ast.isParenthesizedExpression,
    isNonNullExpression: ast.isNonNullExpression,
    isBinaryExpression: ast.isBinaryExpression,
    isArrowFunction: ast.isArrowFunction,
    isFunctionExpression: ast.isFunctionExpression,
    isFunctionDeclaration: ast.isFunctionDeclaration,
    isObjectBindingPattern: ast.isObjectBindingPattern,
    isPropertyAssignment: ast.isPropertyAssignment,
    isShorthandPropertyAssignment: ast.isShorthandPropertyAssignment,
    isSpreadAssignment: ast.isSpreadAssignment,
    isPropertySignature: ast.isPropertySignatureDeclaration,
    isNumericLiteral: ast.isNumericLiteral,
    isStringLiteral: ast.isStringLiteral,
    isStringLiteralLike: (n: Any) => ast.isStringLiteral(n) || n.kind === sk.NoSubstitutionTemplateLiteral,
    isTypeLiteralNode: ast.isTypeLiteralNode,
    isTypeReferenceNode: ast.isTypeReferenceNode,
    isUnionTypeNode: ast.isUnionTypeNode,
    isJsxElement: ast.isJsxElement,
    isJsxSelfClosingElement: ast.isJsxSelfClosingElement,
    isJsxFragment: ast.isJsxFragment,
    isJsxExpression: ast.isJsxExpression,
    isJsxAttribute: ast.isJsxAttribute,
    forEachChild: (node: Any, cb: Any) => { node.forEachChild(cb); },
    kind: {
      TrueKeyword: sk.TrueKeyword,
      FalseKeyword: sk.FalseKeyword,
      NullKeyword: sk.NullKeyword,
      EqualsEqualsEqualsToken: sk.EqualsEqualsEqualsToken,
    },
    text: textOf,
    line: (sf: Any, node: Any): number => {
      const pos = startOf(node, sf);
      let line = 1;
      for (let i = 0; i < pos && i < sf.text.length; i++) if (sf.text[i] === "\n") line++;
      return line;
    },
    // Structural printer for the variables factory (tsgo exposes no single-node
    // printer, and node positions are unreliable across contexts). Reconstructs
    // the small expression grammar the analyzer lifts, rewriting a leading
    // route-param identifier into `ctx.<param>`. Falls back to source text.
    printContextExpr: (expr: Any, paramNames: readonly string[], sf: Any): string => {
      const pr = (n: Any): string => {
        if (ast.isIdentifier(n)) return paramNames.includes(n.text) ? `ctx.${n.text}` : n.text;
        if (ast.isPropertyAccessExpression(n)) return `${pr(n.expression)}.${n.name.text}`;
        if (ast.isElementAccessExpression(n)) return `${pr(n.expression)}[${pr(n.argumentExpression)}]`;
        if (ast.isCallExpression(n)) return `${pr(n.expression)}(${[...n.arguments].map(pr).join(", ")})`;
        if (ast.isParenthesizedExpression(n)) return `(${pr(n.expression)})`;
        // Strip the TS-only non-null assertion — invalid in the emitted JS factory.
        if (ast.isNonNullExpression(n)) return pr(n.expression);
        if (ast.isStringLiteral(n)) return JSON.stringify(n.text);
        if (ast.isNumericLiteral(n)) return n.text;
        return textOf(n, sf);
      };
      return pr(expr);
    },
  };
  return facade as unknown as AstFacade;
}

/**
 * tsgo's `NodeArray` is `RemoteNodeList extends Array`, so `.map`/`.filter` use
 * its species constructor — which builds an empty list with no backing `view`
 * and then throws on element access. Redirect the species to plain `Array`
 * (elements are already materialized through the index getters). Idempotent.
 */
function patchNodeArraySpecies(sourceFile: Any): void {
  const ctor: Any = (sourceFile?.statements as Any)?.constructor;
  if (!ctor || ctor.__graphSpeciesPatched) return;
  Object.defineProperty(ctor, Symbol.species, { get: () => Array, configurable: true });
  ctor.__graphSpeciesPatched = true;
}

/**
 * Index top-level component/helper declarations across all program files by
 * name. tsgo's checker has no `getAliasedSymbol`, so when `resolveDeclaration`
 * lands on an import specifier we resolve the imported name through this index
 * instead of re-implementing module resolution.
 */
function indexDeclarations(program: Any, ast: Any, fileNames: readonly string[]): Map<string, Any> {
  const byName = new Map<string, Any>();
  for (const fileName of fileNames) {
    const sf = program.getSourceFile(fileName);
    if (!sf) continue;
    patchNodeArraySpecies(sf);
    for (const stmt of sf.statements) {
      if (ast.isFunctionDeclaration(stmt) && stmt.name) {
        if (!byName.has(stmt.name.text)) byName.set(stmt.name.text, stmt);
      } else if (ast.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (
            ast.isIdentifier(decl.name) &&
            decl.initializer &&
            (ast.isArrowFunction(decl.initializer) || ast.isFunctionExpression(decl.initializer))
          ) {
            if (!byName.has(decl.name.text)) byName.set(decl.name.text, decl);
          }
        }
      }
    }
  }
  return byName;
}

/** Build the type-engine backend from a tsgo project. */
function makeBackend(session: TsgoSession, fileNames: readonly string[]): GraphCompilerBackend {
  const { project, ast } = session;
  const checker = project.checker;
  const program = project.program;
  const sk = ast.SyntaxKind;
  const IMPORT_KINDS = new Set([sk.ImportSpecifier, sk.ImportClause, sk.NamespaceImport, sk.ImportEqualsDeclaration]);
  let declIndex: Map<string, Any> | undefined;
  const index = () => (declIndex ??= indexDeclarations(program, ast, fileNames));
  let patched = false;
  const { TypeFlags } = session.flags;
  const NULLISH = TypeFlags.Null | TypeFlags.Undefined | TypeFlags.Void;

  const stringLiterals = (type: Any): string[] => {
    if (!type) return [];
    if (type.flags & TypeFlags.Union) return type.getTypes().flatMap(stringLiterals);
    if (type.flags & TypeFlags.StringLiteral) return [type.value];
    return [];
  };

  const graphTypeNamesOfType = (type: Any): readonly string[] | undefined => {
    if (!type) return undefined;
    const constituents = type.flags & TypeFlags.Union ? type.getTypes() : [type];
    const names = new Set<string>();
    let sawGraph = false;
    for (const c of constituents) {
      if (c.flags & NULLISH) continue;
      const typenameSym = checker.getPropertiesOfType(c).find((s: Any) => s.name === "__typename");
      if (!typenameSym) continue;
      for (const literal of stringLiterals(checker.getTypeOfSymbol(typenameSym))) {
        names.add(literal);
        sawGraph = true;
      }
    }
    return sawGraph ? [...names] : undefined;
  };

  const getGraphTypeNames = (node: Any): readonly string[] | undefined =>
    graphTypeNamesOfType(checker.getTypeAtLocation(node));

  return {
    getSourceFile: (fileName) => {
      const sf = program.getSourceFile(fileName);
      if (sf && !patched) { patchNodeArraySpecies(sf); patched = true; }
      return sf as unknown as ts.SourceFile | undefined;
    },
    getGraphTypeNames: (node) => getGraphTypeNames(node),
    getGraphTypeName: (node) => {
      const names = getGraphTypeNames(node);
      return names && names.length === 1 ? names[0] : undefined;
    },
    isGraphBackedType: (node) => getGraphTypeNames(node) !== undefined,
    resolveDeclaration: (node) => {
      const sym = checker.getSymbolAtLocation(node as Any);
      const handle = sym?.valueDeclaration ?? sym?.declarations?.[0];
      const decl: Any = handle?.resolve(project);
      // Same-file declaration: use it directly. Across an import the checker
      // lands on the import specifier (no `getAliasedSymbol` in tsgo) — resolve
      // the imported name through the program-wide declaration index instead.
      if (decl && !IMPORT_KINDS.has(decl.kind)) return decl as unknown as ts.Declaration;
      const name = (node as Any)?.text;
      const fromIndex = typeof name === "string" ? index().get(name) : undefined;
      return (fromIndex ?? decl) as unknown as ts.Declaration | undefined;
    },
    dispose: () => session.dispose(),
  };
}

export interface AnalyzeWithTsgoOptions extends BackendOptions {
  readonly fileName: string;
  readonly schema: SchemaModel;
}

/**
 * Boot a REUSABLE tsgo backend (one program/project over all `fileNames`) plus its
 * AST facade. Async — the engine is dynamically imported + spawned once. Callers
 * loop `analyzeFile({ fileName, backend, schema, ast })` per entrypoint and call
 * `backend.dispose()` when done (it tears down the tsgo project + temp dir). This
 * is the engine-agnostic mirror of the sync `createBackend("typescript", …)`.
 */
export async function createTsgoBackend(
  options: BackendOptions,
): Promise<{ backend: GraphCompilerBackend; ast: AstFacade }> {
  const session = await boot(options);
  return { backend: makeBackend(session, options.fileNames), ast: makeFacade(session.ast) };
}

/**
 * Analyze one entrypoint through the experimental tsgo engine. Async (the engine
 * is dynamically imported + spawned). Returns the same {@link AnalyzeResult} as
 * the `typescript` path.
 */
export async function analyzeWithTsgo(options: AnalyzeWithTsgoOptions): Promise<AnalyzeResult> {
  const { backend, ast } = await createTsgoBackend(options);
  try {
    return analyzeFile({ fileName: options.fileName, backend, schema: options.schema, ast });
  } finally {
    backend.dispose?.();
  }
}
