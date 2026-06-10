import ts from "typescript";

/**
 * The AST primitives the analyzer needs, abstracted from any one parser. The
 * analyzer walks structure through this facade (and routes every *type* question
 * through {@link GraphCompilerBackend}), so the same walker drives both the
 * in-process `typescript` AST and tsgo's `./unstable/ast`.
 *
 * Guards are typed as `typescript` type-predicates so the analyzer keeps full
 * narrowing; an alternative engine's nodes are structurally identical (same
 * `.expression`/`.name`/`.text` getters) and masquerade as `ts.*` at the seam.
 */
export interface AstFacade {
  isIdentifier(n: ts.Node): n is ts.Identifier;
  isBlock(n: ts.Node): n is ts.Block;
  isVariableStatement(n: ts.Node): n is ts.VariableStatement;
  isVariableDeclaration(n: ts.Node): n is ts.VariableDeclaration;
  isIfStatement(n: ts.Node): n is ts.IfStatement;
  isReturnStatement(n: ts.Node): n is ts.ReturnStatement;
  isExpressionStatement(n: ts.Node): n is ts.ExpressionStatement;
  isCallExpression(n: ts.Node): n is ts.CallExpression;
  isPropertyAccessExpression(n: ts.Node): n is ts.PropertyAccessExpression;
  isElementAccessExpression(n: ts.Node): n is ts.ElementAccessExpression;
  isObjectLiteralExpression(n: ts.Node): n is ts.ObjectLiteralExpression;
  isArrayLiteralExpression(n: ts.Node): n is ts.ArrayLiteralExpression;
  isConditionalExpression(n: ts.Node): n is ts.ConditionalExpression;
  isParenthesizedExpression(n: ts.Node): n is ts.ParenthesizedExpression;
  isNonNullExpression(n: ts.Node): n is ts.NonNullExpression;
  isBinaryExpression(n: ts.Node): n is ts.BinaryExpression;
  isArrowFunction(n: ts.Node): n is ts.ArrowFunction;
  isFunctionExpression(n: ts.Node): n is ts.FunctionExpression;
  isFunctionDeclaration(n: ts.Node): n is ts.FunctionDeclaration;
  isObjectBindingPattern(n: ts.Node): n is ts.ObjectBindingPattern;
  isPropertyAssignment(n: ts.Node): n is ts.PropertyAssignment;
  isShorthandPropertyAssignment(n: ts.Node): n is ts.ShorthandPropertyAssignment;
  isSpreadAssignment(n: ts.Node): n is ts.SpreadAssignment;
  isPropertySignature(n: ts.Node): n is ts.PropertySignature;
  isNumericLiteral(n: ts.Node): n is ts.NumericLiteral;
  isStringLiteral(n: ts.Node): n is ts.StringLiteral;
  isStringLiteralLike(n: ts.Node): n is ts.StringLiteralLike;
  isTypeLiteralNode(n: ts.Node): n is ts.TypeLiteralNode;
  isTypeReferenceNode(n: ts.Node): n is ts.TypeReferenceNode;
  isUnionTypeNode(n: ts.Node): n is ts.UnionTypeNode;
  isJsxElement(n: ts.Node): n is ts.JsxElement;
  isJsxSelfClosingElement(n: ts.Node): n is ts.JsxSelfClosingElement;
  isJsxFragment(n: ts.Node): n is ts.JsxFragment;
  isJsxExpression(n: ts.Node): n is ts.JsxExpression;
  isJsxAttribute(n: ts.Node): n is ts.JsxAttribute;

  /** Visit each direct child (normalizes ts' free function vs tsgo's node method). */
  forEachChild(node: ts.Node, cb: (child: ts.Node) => void): void;

  /** The handful of `SyntaxKind` constants the analyzer compares against. */
  readonly kind: {
    readonly TrueKeyword: ts.SyntaxKind;
    readonly FalseKeyword: ts.SyntaxKind;
    readonly NullKeyword: ts.SyntaxKind;
    readonly EqualsEqualsEqualsToken: ts.SyntaxKind;
  };

  /** Source text of a node (for diagnostics messages). */
  text(node: ts.Node, sf: ts.SourceFile): string;
  /** 1-based line of a node's start (for diagnostics). */
  line(sf: ts.SourceFile, node: ts.Node): number;

  /**
   * Print an expression for the variables factory, rewriting free references to
   * route-param identifiers (`params`) into `ctx.params`. (Engine-specific: the
   * `typescript` facade uses the factory + printer; tsgo rewrites source text.)
   */
  printContextExpr(expr: ts.Expression, paramNames: readonly string[], sf: ts.SourceFile): string;
}

function substituteCtx(expr: ts.Expression, paramNames: readonly string[]): ts.Expression {
  const visit = (node: ts.Node): ts.Node => {
    // Strip TS-only syntax that would be invalid in the emitted JS factory
    // (`x!`, `x as T`, `x satisfies T`) — unwrap to the operand.
    if (ts.isNonNullExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
      return visit(node.expression);
    }
    if (ts.isPropertyAccessExpression(node)) {
      return ts.factory.updatePropertyAccessExpression(node, visit(node.expression) as ts.Expression, node.name);
    }
    if (ts.isIdentifier(node) && paramNames.includes(node.text)) {
      return ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("ctx"), node.text);
    }
    return ts.visitEachChild(node, visit, undefined);
  };
  return visit(expr) as ts.Expression;
}

/** The in-process `typescript` engine facade — the default. */
export const typescriptFacade: AstFacade = {
  isIdentifier: ts.isIdentifier,
  isBlock: ts.isBlock,
  isVariableStatement: ts.isVariableStatement,
  isVariableDeclaration: ts.isVariableDeclaration,
  isIfStatement: ts.isIfStatement,
  isReturnStatement: ts.isReturnStatement,
  isExpressionStatement: ts.isExpressionStatement,
  isCallExpression: ts.isCallExpression,
  isPropertyAccessExpression: ts.isPropertyAccessExpression,
  isElementAccessExpression: ts.isElementAccessExpression,
  isObjectLiteralExpression: ts.isObjectLiteralExpression,
  isArrayLiteralExpression: ts.isArrayLiteralExpression,
  isConditionalExpression: ts.isConditionalExpression,
  isParenthesizedExpression: ts.isParenthesizedExpression,
  isNonNullExpression: ts.isNonNullExpression,
  isBinaryExpression: ts.isBinaryExpression,
  isArrowFunction: ts.isArrowFunction,
  isFunctionExpression: ts.isFunctionExpression,
  isFunctionDeclaration: ts.isFunctionDeclaration,
  isObjectBindingPattern: ts.isObjectBindingPattern,
  isPropertyAssignment: ts.isPropertyAssignment,
  isShorthandPropertyAssignment: ts.isShorthandPropertyAssignment,
  isSpreadAssignment: ts.isSpreadAssignment,
  isPropertySignature: ts.isPropertySignature,
  isNumericLiteral: ts.isNumericLiteral,
  isStringLiteral: ts.isStringLiteral,
  isStringLiteralLike: ts.isStringLiteralLike,
  isTypeLiteralNode: ts.isTypeLiteralNode,
  isTypeReferenceNode: ts.isTypeReferenceNode,
  isUnionTypeNode: ts.isUnionTypeNode,
  isJsxElement: ts.isJsxElement,
  isJsxSelfClosingElement: ts.isJsxSelfClosingElement,
  isJsxFragment: ts.isJsxFragment,
  isJsxExpression: ts.isJsxExpression,
  isJsxAttribute: ts.isJsxAttribute,
  forEachChild: (node, cb) => { ts.forEachChild(node, cb); },
  kind: {
    TrueKeyword: ts.SyntaxKind.TrueKeyword,
    FalseKeyword: ts.SyntaxKind.FalseKeyword,
    NullKeyword: ts.SyntaxKind.NullKeyword,
    EqualsEqualsEqualsToken: ts.SyntaxKind.EqualsEqualsEqualsToken,
  },
  text: (node, sf) => node.getText(sf),
  line: (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
  printContextExpr: (expr, paramNames, sf) =>
    ts.createPrinter({ removeComments: true }).printNode(
      ts.EmitHint.Expression,
      substituteCtx(expr, paramNames),
      sf,
    ),
};
