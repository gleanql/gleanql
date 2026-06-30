import type ts from "typescript";
import type { ArgValue } from "@gleanql/core";
import type { AstFacade } from "./ast-facade.js";

/**
 * Argument capture + variables-factory generation.
 *
 * Root-call arguments are lifted into operation variables. A "simple" argument
 * is a pure property path on a route parameter (`params.handle`); it keeps the
 * argument's own name (`$handle`) and the factory returns `ctx.<path>`. A
 * "complex" argument (anything with a call/transform) is lifted under a
 * root-prefixed name (`$product_handle`); if it flows through a local `const`,
 * the factory reproduces that local with `params` rewritten to `ctx.params`.
 */
export interface LiftedVariable {
  readonly name: string;
  readonly type: string;
}

/**
 * Identifiers that are always available wherever a variables factory runs, so an
 * arg referencing only these (plus route params) stays ctx-derivable (preloaded).
 * Anything else (an in-render local, a module import) makes the arg a render-time
 * "deferred" variable, executed at the call-site instead.
 */
const KNOWN_GLOBALS = new Set<string>([
  "Math", "JSON", "Number", "String", "Boolean", "Array", "Object", "Date",
  "parseInt", "parseFloat", "isNaN", "isFinite", "BigInt", "Symbol",
  "undefined", "NaN", "Infinity", "encodeURIComponent", "decodeURIComponent",
  "btoa", "atob", "structuredClone",
]);

interface FactoryEntry {
  readonly varName: string;
  readonly valueSource: string;
}

export class VariablesBuilder {
  private readonly vars: LiftedVariable[] = [];
  private readonly entries: FactoryEntry[] = [];
  private readonly locals = new Map<string, string>();
  private readonly deferredVars = new Set<string>();

  constructor(
    private readonly routeName: string,
    private readonly paramNames: readonly string[],
    private readonly sourceFile: ts.SourceFile,
    private readonly ast: AstFacade,
  ) {}

  lift(
    rootField: string,
    argName: string,
    argType: string,
    valueExpr: ts.Expression,
    resolveLocal: (name: string) => { name: string; init: ts.Expression } | undefined,
  ): ArgValue {
    // Resolve a shorthand/identifier referencing a route-local const.
    let effective = valueExpr;
    let localName: string | undefined;
    if (this.ast.isIdentifier(valueExpr)) {
      const local = resolveLocal(valueExpr.text);
      if (local) {
        effective = local.init;
        localName = local.name;
      }
    }

    if (this.isPureContextPath(effective)) {
      const varName = argName;
      this.addVar(varName, argType);
      this.addEntry(varName, this.printSubstituted(effective));
      return { kind: "var", name: varName };
    }

    // Render-time ("two-sweep") argument: it references an in-render binding (a
    // `const` computed during render) or a module import, neither of which the
    // ctx preload factory can reproduce (the factory only has `ctx`, runs before
    // render, and can't re-run an `await`). Allocate the $var so the document
    // still declares it, mark it deferred, and emit NO factory entry — the
    // runtime executes this root at the call-site with the args the read proxy
    // already received. `ctx` is just the variable source that's known early;
    // this is the source that's only known mid-render.
    if (!this.isCtxDerivable(effective)) {
      const varName = `${rootField}_${argName}`;
      this.addVar(varName, argType);
      this.deferredVars.add(varName);
      return { kind: "var", name: varName };
    }

    // Complex argument: lift under a root-prefixed name. When it flows through a
    // route-local const, reproduce that local and reference it; otherwise inline
    // the (context-substituted) source.
    const varName = `${rootField}_${argName}`;
    this.addVar(varName, argType);
    if (localName) {
      if (!this.locals.has(localName)) {
        this.locals.set(localName, this.printSubstituted(effective));
      }
      this.addEntry(varName, localName);
    } else {
      this.addEntry(varName, this.printSubstituted(effective));
    }
    return { kind: "var", name: varName };
  }

  get variables(): readonly LiftedVariable[] {
    return this.vars;
  }

  get exportName(): string {
    return `get${this.routeName}Variables`;
  }

  /** Variable names supplied at the render call-site (omitted from the factory). */
  get deferred(): readonly string[] {
    return [...this.deferredVars];
  }

  buildSource(): string {
    const localLines = [...this.locals.entries()].map(([name, src]) => `  const ${name} = ${src};`);
    const entryLines = this.entries.map((e) => `    ${e.varName}: ${e.valueSource},`);
    const body = [
      ...localLines,
      "  return {",
      ...entryLines,
      "  };",
    ].join("\n");
    return `export function ${this.exportName}(ctx) {\n${body}\n}\n`;
  }

  /** Add a factory entry, deduped by var name — the same root arg may be lifted by
   * both the route and an island that forwards it (they produce identical sources). */
  private addEntry(varName: string, valueSource: string): void {
    if (!this.entries.some((e) => e.varName === varName)) this.entries.push({ varName, valueSource });
  }

  private addVar(name: string, type: string): void {
    if (!this.vars.some((v) => v.name === name)) this.vars.push({ name, type });
  }

  private isPureContextPath(expr: ts.Expression): boolean {
    if (this.ast.isIdentifier(expr)) return this.paramNames.includes(expr.text);
    if (this.ast.isPropertyAccessExpression(expr)) return this.isPureContextPath(expr.expression);
    if (this.ast.isElementAccessExpression(expr)) {
      return (
        this.isPureContextPath(expr.expression) &&
        (this.ast.isStringLiteral(expr.argumentExpression) || this.ast.isNumericLiteral(expr.argumentExpression))
      );
    }
    if (this.ast.isNonNullExpression(expr) || this.ast.isParenthesizedExpression(expr)) {
      return this.isPureContextPath(expr.expression);
    }
    return false;
  }

  /** True when every free identifier in `expr` is a route param or a known global
   * — i.e. the value can be reproduced in the `getXVariables(ctx)` preload factory.
   * A free reference to anything else (an in-render local, a module import) means
   * the arg is only knowable at the render call-site → it must be deferred. */
  private isCtxDerivable(expr: ts.Expression): boolean {
    for (const id of this.freeIdentifiers(expr)) {
      if (this.paramNames.includes(id)) continue;
      if (KNOWN_GLOBALS.has(id)) continue;
      return false;
    }
    return true;
  }

  /** Identifiers referenced as *values* in `expr` — excluding property names,
   * object-literal keys, and names bound by nested functions/arrows within it. */
  private freeIdentifiers(expr: ts.Expression): Set<string> {
    const free = new Set<string>();
    const collectBound = (name: ts.Node, set: Set<string>): void => {
      if (this.ast.isIdentifier(name)) {
        set.add(name.text);
        return;
      }
      this.ast.forEachChild(name, (c) => collectBound(c, set)); // binding patterns
    };
    const walk = (node: ts.Node, bound: ReadonlySet<string>): void => {
      if (this.ast.isPropertyAccessExpression(node)) {
        walk(node.expression, bound); // `a.b` references `a`, not `b`
        return;
      }
      if (this.ast.isPropertyAssignment(node)) {
        walk(node.initializer, bound); // `{ key: value }` — key is not a reference
        return;
      }
      if (this.ast.isShorthandPropertyAssignment(node)) {
        if (!bound.has(node.name.text)) free.add(node.name.text); // `{ x }` references x
        return;
      }
      if (this.ast.isArrowFunction(node) || this.ast.isFunctionExpression(node)) {
        const inner = new Set(bound);
        for (const param of (node as ts.ArrowFunction).parameters) collectBound(param.name, inner);
        walk((node as ts.ArrowFunction).body, inner); // body only; params are bound
        return;
      }
      if (this.ast.isIdentifier(node)) {
        if (!bound.has(node.text)) free.add(node.text);
        return;
      }
      this.ast.forEachChild(node, (c) => walk(c, bound));
    };
    walk(expr, new Set());
    return free;
  }

  /** Print an expression with route-param identifiers rewritten to `ctx.<param>`. */
  private printSubstituted(expr: ts.Expression): string {
    return this.ast.printContextExpr(expr, this.paramNames, this.sourceFile);
  }
}
