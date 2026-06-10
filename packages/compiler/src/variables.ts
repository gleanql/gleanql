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

interface FactoryEntry {
  readonly varName: string;
  readonly valueSource: string;
}

export class VariablesBuilder {
  private readonly vars: LiftedVariable[] = [];
  private readonly entries: FactoryEntry[] = [];
  private readonly locals = new Map<string, string>();

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

  /** Print an expression with route-param identifiers rewritten to `ctx.<param>`. */
  private printSubstituted(expr: ts.Expression): string {
    return this.ast.printContextExpr(expr, this.paramNames, this.sourceFile);
  }
}
