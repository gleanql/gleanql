import ts from "typescript";
import {
  type SchemaModel,
  type OperationArtifact,
  type ReadMap,
  type OperationIR,
  type SelectionSet,
  type ArgMap,
  type ArgValue,
  canonicalArgs,
  mergeSelectionSets,
  printOperation,
  hashDocument,
} from "@gleanql/core";
import type { GraphCompilerBackend } from "./backend.js";
import { type AstFacade, typescriptFacade } from "./ast-facade.js";
import { MutableSelection } from "./mutable.js";
import { VariablesBuilder } from "./variables.js";
import { findSelectorHookSites } from "./mutation-binding.js";
import { compileSelectorOperation, type SelectorCompileContext } from "./selector-compile.js";
import { type Diagnostic, type DiagnosticCode, messages } from "./diagnostics.js";

export interface AnalyzeInput {
  readonly fileName: string;
  readonly backend: GraphCompilerBackend;
  readonly schema: SchemaModel;
  /** AST primitives. Defaults to the in-process `typescript` engine. */
  readonly ast?: AstFacade;
}

export interface AnalyzeResult {
  readonly operations: readonly OperationArtifact[];
  readonly readMap: ReadMap;
  readonly diagnostics: readonly Diagnostic[];
}

/** A live graph-backed value flowing through component code. */
interface GraphValue {
  /** Current GraphQL type. */
  typeName: string;
  /** Selection node new reads attach to. */
  sel: MutableSelection;
  /** Whether this value is a list (enables `.map`/`.filter`/`[i]`). */
  isList: boolean;
  /** Base type for read-map paths (resets on entering a component / list element). */
  readBase: string;
  /** Path from `readBase`. */
  readPath: readonly string[];
}

interface ComponentInfo {
  readonly name: string;
  readonly params: ts.NodeArray<ts.ParameterDeclaration>;
  readonly body: ts.Node | undefined;
  readonly declNode: ts.Node;
}

type ComponentResolution =
  | { readonly kind: "components"; readonly candidates: readonly ComponentInfo[] }
  | { readonly kind: "unresolved" };

interface Scope {
  readonly graphVars: Map<string, GraphValue>;
  readonly componentVars: Map<string, ComponentResolution>;
  readonly registries: Map<string, readonly ComponentInfo[]>;
  /** Identifiers that hold the graph accessor in this component (imported `graph` + `useGraph()` locals). */
  readonly accessors: ReadonlySet<string>;
}

export function analyzeFile(input: AnalyzeInput): AnalyzeResult {
  const sf = input.backend.getSourceFile(input.fileName);
  if (!sf) throw new Error(`Source file not found in program: ${input.fileName}`);
  return new Analyzer(sf, input.backend, input.schema, input.ast ?? typescriptFacade).run();
}

class Analyzer {
  private readonly diagnostics: Diagnostic[] = [];
  private readonly readMap = new Map<string, string[]>();
  private readonly componentsByName = new Map<string, ComponentInfo>();
  private readonly componentsByDecl = new Map<ts.Node, ComponentInfo>();
  private readonly visited = new Set<string>();
  private readonly consumed = new WeakSet<ts.Node>();
  private readonly globalRegistries = new Map<string, readonly ComponentInfo[]>();
  /** >0 while walking inside a <GraphLazy> boundary; suppresses operation reads. */
  private lazyDepth = 0;

  constructor(
    private readonly sf: ts.SourceFile,
    private readonly backend: GraphCompilerBackend,
    private readonly schema: SchemaModel,
    private readonly ast: AstFacade,
  ) {}

  run(): AnalyzeResult {
    this.indexComponents();
    this.indexRegistries();
    const operations: OperationArtifact[] = [];

    // Routes = top-level components of THIS file that create graph roots. Snapshot
    // before the loop: `analyzeRoute` follows imported children into
    // `componentsByName`, and those are children (merged into their parent's
    // operation), never routes in their own right — iterating the live map would
    // wrongly compile a `graph`-reading island (e.g. a `"use client"` refetch
    // island) into a spurious standalone operation.
    const topLevel = [...this.componentsByName.values()];
    for (const comp of topLevel) {
      if (this.containsGraphRoot(comp)) {
        const artifact = this.analyzeRoute(comp);
        if (artifact) operations.push(artifact);
        this.visited.add(comp.name);
      }
    }

    // Standalone components (with graph props) not reached by a route: still
    // extract read maps + diagnostics.
    for (const comp of this.componentsByName.values()) {
      if (this.visited.has(comp.name)) continue;
      if (this.graphProps(comp).length === 0) continue;
      this.analyzeStandalone(comp);
    }

    // Selector hooks: `useMutation`/`useSubscription(selector)` calls anywhere in
    // the file compile to standalone mutation/subscription operations (gqty-style).
    for (const op of this.analyzeSelectorHooks()) operations.push(op);

    return {
      operations,
      readMap: this.toReadMap(),
      diagnostics: this.diagnostics,
    };
  }

  // --- discovery ---------------------------------------------------------

  private indexComponents(): void {
    for (const stmt of this.sf.statements) {
      if (this.ast.isFunctionDeclaration(stmt) && stmt.name) {
        this.addComponent(stmt.name.text, stmt.parameters, stmt.body, stmt);
      } else if (this.ast.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) {
          if (
            this.ast.isIdentifier(decl.name) &&
            decl.initializer &&
            (this.ast.isArrowFunction(decl.initializer) || this.ast.isFunctionExpression(decl.initializer))
          ) {
            this.addComponent(decl.name.text, decl.initializer.parameters, decl.initializer.body, decl);
          }
        }
      }
    }
  }

  private indexRegistries(): void {
    for (const stmt of this.sf.statements) {
      if (!this.ast.isVariableStatement(stmt)) continue;
      for (const decl of stmt.declarationList.declarations) {
        if (
          this.ast.isIdentifier(decl.name) &&
          decl.initializer &&
          this.ast.isCallExpression(decl.initializer) &&
          this.isGraphComponents(decl.initializer)
        ) {
          this.globalRegistries.set(decl.name.text, this.resolveRegistry(decl.initializer));
        }
      }
    }
  }

  private addComponent(
    name: string,
    params: ts.NodeArray<ts.ParameterDeclaration>,
    body: ts.Node | undefined,
    declNode: ts.Node,
  ): void {
    const info: ComponentInfo = { name, params, body, declNode };
    this.componentsByName.set(name, info);
    this.componentsByDecl.set(declNode, info);
  }

  private containsGraphRoot(comp: ComponentInfo): boolean {
    const accessors = this.graphAccessorNames(comp.body);
    let found = false;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (this.ast.isCallExpression(node) && this.graphRootName(node, accessors)) found = true;
      else this.ast.forEachChild(node, visit);
    };
    if (comp.body) visit(comp.body);
    return found;
  }

  // --- route analysis ----------------------------------------------------

  private analyzeRoute(comp: ComponentInfo): OperationArtifact | undefined {
    if (!comp.body) return undefined;
    const rootSel = new MutableSelection(this.schema.queryType);
    const paramNames = this.routeParamNames(comp);
    const vars = new VariablesBuilder(comp.name, paramNames, this.sf, this.ast);
    const scope = this.newScope(comp.body);

    const resolveLocal = (name: string) => this.resolveRouteLocal(comp, name);

    this.walkStatement(comp.body, scope, comp.name, [comp.name], {
      rootSel,
      vars,
      resolveLocal,
    });

    const ir: OperationIR = {
      kind: "query",
      name: comp.name,
      variables: vars.variables.map((v) => ({ name: v.name, type: v.type })),
      selection: mergeSelectionSets([rootSel.toIR()], this.schema, { isRoot: true }),
    };
    const document = printOperation(ir);
    return {
      name: comp.name,
      kind: "query",
      document,
      hash: hashDocument(document),
      variablesFactory: { exportName: vars.exportName, source: vars.buildSource() },
      readMap: this.toReadMap(),
      selection: ir.selection,
      variableDefs: ir.variables,
      source: this.sf.fileName,
      stats: this.computeStats(ir.selection),
    };
  }

  private analyzeStandalone(comp: ComponentInfo): void {
    if (!comp.body) return;
    const scope = this.newScope(comp.body);
    for (const prop of this.graphProps(comp)) {
      const sel = new MutableSelection(prop.typeName);
      scope.graphVars.set(prop.localName, {
        typeName: prop.typeName,
        sel,
        isList: false,
        readBase: prop.typeName,
        readPath: [],
      });
    }
    this.visited.add(comp.name);
    this.ensureReadMap(comp.name);
    this.walkStatement(comp.body, scope, comp.name, [comp.name]);
  }

  // --- selector-hook analysis (mutations + subscriptions) ----------------

  /**
   * Compile each `useMutation`/`useSubscription(selector)` in this file into a
   * standalone mutation/subscription operation. The compilation itself lives in
   * {@link compileSelectorOperation} (selectors are self-contained — no route scope,
   * JSX or read-map — so they don't belong in the route-walk machinery); this just
   * routes each call site to its root type and hands over the pieces it needs.
   */
  private analyzeSelectorHooks(): OperationArtifact[] {
    const rootTypeFor = { mutation: this.schema.mutationType, subscription: this.schema.subscriptionType } as const;
    const ctx: SelectorCompileContext = {
      schema: this.schema,
      ast: this.ast,
      sf: this.sf,
      parseArgs: (node) => this.parseArgs(node),
      argEntry: (prop) => this.argEntry(prop),
      computeStats: (selection) => this.computeStats(selection),
    };
    const out: OperationArtifact[] = [];
    for (const site of findSelectorHookSites(this.sf, this.ast)) {
      const rootType = rootTypeFor[site.kind as "mutation" | "subscription"];
      if (!rootType) continue; // schema has no such root
      const artifact = compileSelectorOperation(site, rootType, ctx);
      if (artifact) out.push(artifact);
    }
    return out;
  }

  // --- statement walking -------------------------------------------------

  private walkStatement(
    node: ts.Node,
    scope: Scope,
    component: string,
    stack: readonly string[],
    route?: RouteCtx,
  ): void {
    if (this.ast.isBlock(node)) {
      for (const s of node.statements) this.walkStatement(s, scope, component, stack, route);
      return;
    }
    if (this.ast.isVariableStatement(node)) {
      for (const decl of node.declarationList.declarations) {
        this.bindDeclaration(decl, scope, component, stack, route);
      }
      return;
    }
    if (this.ast.isIfStatement(node)) {
      this.walkIf(node, scope, component, stack, route);
      return;
    }
    if (this.ast.isReturnStatement(node)) {
      if (node.expression) this.scan(node.expression, scope, component, stack, route);
      return;
    }
    if (this.ast.isExpressionStatement(node)) {
      this.scan(node.expression, scope, component, stack, route);
      return;
    }
    this.ast.forEachChild(node, (child) => this.walkStatement(child, scope, component, stack, route));
  }

  private walkIf(
    node: ts.IfStatement,
    scope: Scope,
    component: string,
    stack: readonly string[],
    route?: RouteCtx,
  ): void {
    const narrow = this.detectTypenameNarrow(node.expression, scope);
    if (narrow) {
      const frag = narrow.gv.sel.inlineFragment(narrow.typeName);
      const narrowed: GraphValue = {
        typeName: narrow.typeName,
        sel: frag.selection,
        isList: false,
        readBase: narrow.typeName,
        readPath: [],
      };
      const prev = scope.graphVars.get(narrow.varName);
      scope.graphVars.set(narrow.varName, narrowed);
      this.walkStatement(node.thenStatement, scope, component, stack, route);
      if (prev) scope.graphVars.set(narrow.varName, prev);
      else scope.graphVars.delete(narrow.varName);
      if (node.elseStatement) this.walkStatement(node.elseStatement, scope, component, stack, route);
      return;
    }
    this.scan(node.expression, scope, component, stack, route);
    this.walkStatement(node.thenStatement, scope, component, stack, route);
    if (node.elseStatement) this.walkStatement(node.elseStatement, scope, component, stack, route);
  }

  private bindDeclaration(
    decl: ts.VariableDeclaration,
    scope: Scope,
    component: string,
    stack: readonly string[],
    route?: RouteCtx,
  ): void {
    const init = decl.initializer;
    if (!init) return;

    // Root call: const product = graph.product({ handle })
    if (route && this.ast.isIdentifier(decl.name) && this.ast.isCallExpression(init) && this.graphRootName(init, scope.accessors)) {
      const gv = this.createRoot(init, route, scope.accessors);
      if (gv) scope.graphVars.set(decl.name.text, gv);
      return;
    }

    // Registry: const views = graph.components({ card: ProductCard, ... })
    if (this.ast.isIdentifier(decl.name) && this.ast.isCallExpression(init) && this.isGraphComponents(init)) {
      scope.registries.set(decl.name.text, this.resolveRegistry(init));
      return;
    }

    // Destructuring from a graph value: const { title, featuredImage } = product
    if (this.ast.isObjectBindingPattern(decl.name)) {
      const base = this.evalExpr(init, scope, component, stack, route);
      if (base) {
        this.bindDestructured(decl.name, base, component, (name, child) => scope.graphVars.set(name, child));
        return;
      }
    }

    if (this.ast.isIdentifier(decl.name)) {
      // Component alias / dynamic component binding.
      const comp = this.resolveComponentExpr(init, scope);
      if (comp) {
        scope.componentVars.set(decl.name.text, comp);
        return;
      }
      // Graph value alias.
      const gv = this.evalExpr(init, scope, component, stack, route);
      if (gv) {
        scope.graphVars.set(decl.name.text, gv);
        return;
      }
    }

    this.scan(init, scope, component, stack, route);
  }

  // --- generic scan (reads / JSX / diagnostics) --------------------------

  private scan(
    node: ts.Node,
    scope: Scope,
    component: string,
    stack: readonly string[],
    route?: RouteCtx,
  ): void {
    if (this.isJsx(node)) {
      this.handleJsx(node, scope, component, stack, route);
      return;
    }
    if (this.ast.isJsxExpression(node)) {
      if (node.expression) this.scan(node.expression, scope, component, stack, route);
      return;
    }
    if (this.ast.isParenthesizedExpression(node)) {
      this.scan(node.expression, scope, component, stack, route);
      return;
    }
    if (this.ast.isPropertyAccessExpression(node) || this.ast.isElementAccessExpression(node) || this.ast.isIdentifier(node)) {
      this.evalExpr(node, scope, component, stack, route);
      return;
    }
    if (this.ast.isCallExpression(node)) {
      this.evalExpr(node, scope, component, stack, route);
      if (!this.consumed.has(node)) this.tryEnterHelper(node, scope, component, stack, route);
      const handled = this.consumed.has(node);
      for (const arg of node.arguments) {
        if (handled && (this.ast.isArrowFunction(arg) || this.ast.isFunctionExpression(arg))) continue;
        this.scan(arg, scope, component, stack, route);
      }
      return;
    }
    if (this.ast.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) {
        if (this.ast.isSpreadAssignment(prop)) {
          this.checkSpread(prop.expression, scope, component, stack, route);
        } else if (this.ast.isPropertyAssignment(prop)) {
          this.scan(prop.initializer, scope, component, stack, route);
        }
      }
      return;
    }
    if (this.ast.isConditionalExpression(node)) {
      this.scan(node.condition, scope, component, stack, route);
      this.scan(node.whenTrue, scope, component, stack, route);
      this.scan(node.whenFalse, scope, component, stack, route);
      return;
    }
    this.ast.forEachChild(node, (child) => this.scan(child, scope, component, stack, route));
  }

  private checkSpread(
    expr: ts.Expression,
    scope: Scope,
    component: string,
    stack: readonly string[],
    route?: RouteCtx,
  ): void {
    if (this.ast.isIdentifier(expr) && scope.graphVars.has(expr.text)) {
      this.addDiagnostic("graph-value-spread", messages.graphValueSpread(expr.text), expr);
      return;
    }
    this.scan(expr, scope, component, stack, route);
  }

  // --- expression evaluation (returns a GraphValue when graph-backed) ----

  private evalExpr(
    node: ts.Node,
    scope: Scope,
    component: string,
    stack: readonly string[],
    route?: RouteCtx,
  ): GraphValue | undefined {
    if (this.ast.isParenthesizedExpression(node) || this.ast.isNonNullExpression(node)) {
      return this.evalExpr(node.expression, scope, component, stack, route);
    }
    if (this.ast.isIdentifier(node)) {
      return scope.graphVars.get(node.text);
    }
    if (this.ast.isPropertyAccessExpression(node)) {
      const base = this.evalExpr(node.expression, scope, component, stack, route);
      if (!base) return undefined;
      const fieldName = node.name.text;
      if (fieldName === "__typename") return undefined;
      const child = this.readField(base, fieldName, undefined, component);
      this.consumed.add(node);
      return child;
    }
    if (this.ast.isElementAccessExpression(node)) {
      const base = this.evalExpr(node.expression, scope, component, stack, route);
      if (!base) return undefined;
      this.consumed.add(node);
      const arg = node.argumentExpression;
      if (base.isList && (this.ast.isNumericLiteral(arg) || this.ast.isStringLiteral(arg))) {
        return { typeName: base.typeName, sel: base.sel, isList: false, readBase: base.typeName, readPath: [] };
      }
      if (this.ast.isStringLiteralLike(arg)) {
        return this.readField(base, arg.text, undefined, component);
      }
      // product[fieldName] — dynamic field access.
      const exprText = this.ast.text(node, this.sf);
      this.addDiagnostic("dynamic-field-access", messages.dynamicFieldAccess(exprText), node);
      return undefined;
    }
    if (this.ast.isCallExpression(node)) {
      return this.evalCall(node, scope, component, stack, route);
    }
    return undefined;
  }

  private evalCall(
    node: ts.CallExpression,
    scope: Scope,
    component: string,
    stack: readonly string[],
    route?: RouteCtx,
  ): GraphValue | undefined {
    const callee = node.expression;
    if (!this.ast.isPropertyAccessExpression(callee)) return undefined;
    const methodName = callee.name.text;

    // Root call anywhere — `glean.product({ handle })`, including mid-chain like
    // `glean.board().todos` (where the binding is a property access, so the
    // declaration fast-path in `bindDeclaration` doesn't fire). Needs route context to
    // lift the args; `createRoot` find-or-creates, so it dedupes with other reads.
    if (route && this.graphRootName(node, scope.accessors)) {
      this.consumed.add(node);
      return this.createRoot(node, route, scope.accessors);
    }

    // List iteration: nodes.map/filter/find/forEach(cb)
    if (methodName === "map" || methodName === "filter" || methodName === "find" || methodName === "forEach") {
      const base = this.evalExpr(callee.expression, scope, component, stack, route);
      if (base && base.isList) {
        this.consumed.add(node);
        const element: GraphValue = {
          typeName: base.typeName,
          sel: base.sel,
          isList: false,
          readBase: base.typeName,
          readPath: [],
        };
        const cb = node.arguments[0];
        // An unanalyzable callback would silently UNDER-FETCH (its element reads
        // never reach the operation) — that must be a diagnostic, never a no-op.
        if (cb && !this.enterListCallback(cb, element, scope, component, stack, route)) {
          this.addDiagnostic("unsupported-list-flow", messages.unsupportedListFlow(this.ast.text(cb, this.sf)), cb);
        }
        if (methodName === "filter") return base;
        if (methodName === "find") return element;
        return undefined;
      }
    }

    // Callable field: obj.field({ ...args })
    const base = this.evalExpr(callee.expression, scope, component, stack, route);
    if (base) {
      const def = this.schema.getField(base.typeName, methodName);
      if (def) {
        this.consumed.add(node);
        const args = this.parseArgs(node.arguments[0]);
        return this.readField(base, methodName, args, component);
      }
    }
    return undefined;
  }

  /** Record a field read on a graph value; returns the child value for object fields. */
  private readField(
    base: GraphValue,
    fieldName: string,
    args: ArgMap | undefined,
    component: string,
  ): GraphValue | undefined {
    const def = this.schema.getField(base.typeName, fieldName);
    if (!def) return undefined;
    const isLeaf = this.schema.isLeaf(def.type);

    // Inside a lazy boundary: do not contribute to the initial operation or
    // read map. Still walk so nested object access keeps flowing.
    if (this.lazyDepth > 0) {
      if (isLeaf) return undefined;
      return {
        typeName: def.type,
        sel: new MutableSelection(def.type),
        isList: def.list ?? false,
        readBase: base.readBase,
        readPath: [...base.readPath, fieldName],
      };
    }

    const key = canonicalArgs(args);
    const field = base.sel.field(fieldName, key, () => ({
      name: fieldName,
      key,
      ...(args ? { args } : {}),
      child: isLeaf ? undefined : new MutableSelection(def.type),
    }));
    const newPath = [...base.readPath, fieldName];
    if (isLeaf) {
      this.recordRead(component, `${base.readBase}.${newPath.join(".")}`);
      return undefined;
    }
    return {
      typeName: def.type,
      sel: field.child!,
      isList: def.list ?? false,
      readBase: base.readBase,
      readPath: newPath,
    };
  }

  // --- JSX ---------------------------------------------------------------

  private handleJsx(
    node: ts.Node,
    scope: Scope,
    component: string,
    stack: readonly string[],
    route?: RouteCtx,
  ): void {
    if (this.ast.isJsxFragment(node)) {
      for (const child of node.children) this.scan(child, scope, component, stack, route);
      return;
    }
    const opening = this.ast.isJsxElement(node) ? node.openingElement : (node as ts.JsxSelfClosingElement);
    const tag = opening.tagName;
    const attrs = opening.attributes;

    // Lazy boundary: reads inside are excluded from the initial operation and
    // fetched at runtime when the boundary renders.
    if (this.ast.isIdentifier(tag) && tag.text === "GraphLazy") {
      this.lazyDepth++;
      if (this.ast.isJsxElement(node)) {
        for (const child of node.children) this.scan(child, scope, component, stack, route);
      }
      this.lazyDepth--;
      return;
    }

    // Evaluate attribute expressions (records reads) and collect props: graph
    // values flow into graph-prop children; scalar expressions are kept so a child
    // that opens its own root (an island) can resolve a forwarded root argument
    // (e.g. `<RefreshViews handle={params.handle}/>` → `graph.product({ handle })`).
    const propValues = new Map<string, GraphValue>();
    const scalarProps = new Map<string, ts.Expression>();
    for (const attr of attrs.properties) {
      if (this.ast.isJsxAttribute(attr) && attr.initializer && this.ast.isJsxExpression(attr.initializer)) {
        const expr = attr.initializer.expression;
        if (expr) {
          // Read the name off the identifier directly — `getText(this.sf)` returns ""
          // when the attribute lives in an imported component's file, not the entry one.
          const name = this.ast.isIdentifier(attr.name) ? attr.name.text : this.ast.text(attr.name, this.sf);
          const gv = this.evalExpr(expr, scope, component, stack, route);
          if (gv) propValues.set(name, gv);
          else {
            scalarProps.set(name, expr);
            this.scan(expr, scope, component, stack, route);
          }
        }
      }
    }

    const isComponentTag = this.ast.isIdentifier(tag) && /^[A-Z]/.test(tag.text);
    if (isComponentTag && this.ast.isIdentifier(tag)) {
      const resolution = this.resolveTag(tag, scope);
      if (resolution.kind === "unresolved") {
        if (propValues.size > 0) {
          const props = [...propValues.entries()].map(
            ([n, gv]) => [n, gv.typeName] as readonly [string, string],
          );
          this.addDiagnostic("unresolved-dynamic-component", messages.unresolvedDynamicComponent(tag.text, props), tag);
        }
      } else {
        for (const candidate of resolution.candidates) {
          this.enterComponent(candidate, propValues, stack, route, scalarProps);
        }
      }
    }

    if (this.ast.isJsxElement(node)) {
      for (const child of node.children) this.scan(child, scope, component, stack, route);
    }
  }

  private enterComponent(
    comp: ComponentInfo,
    propValues: ReadonlyMap<string, GraphValue>,
    stack: readonly string[],
    route?: RouteCtx,
    scalarProps?: ReadonlyMap<string, ts.Expression>,
  ): void {
    if (stack.includes(comp.name)) {
      this.addDiagnostic("recursive-component", messages.recursiveComponent(comp.name), comp.declNode);
      return;
    }
    if (!comp.body) return;
    const scope = this.newScope(comp.body);
    for (const prop of this.graphProps(comp)) {
      const passed = propValues.get(prop.localName);
      if (!passed) continue;
      scope.graphVars.set(prop.localName, {
        typeName: prop.typeName,
        sel: passed.sel,
        isList: passed.isList,
        readBase: prop.typeName,
        readPath: [],
      });
    }
    this.visited.add(comp.name);
    this.ensureReadMap(comp.name);
    // An island that opens its OWN graph root (e.g. `const graph = useGraph()` then
    // `graph.product(...)`) contributes its reads to the enclosing route's operation
    // + read-map — so the page fetches those fields and `refresh()` can target them.
    // Forwarded scalar props (the `handle` in `<RefreshViews handle={params.handle}/>`)
    // resolve to the render-site expression so the root arg lifts to the same variable.
    if (route && this.containsGraphRoot(comp)) {
      const resolveLocal = (name: string) =>
        (scalarProps?.has(name) ? { name, init: scalarProps.get(name)! } : undefined) ??
        this.resolveRouteLocal(comp, name);
      this.walkStatement(comp.body, scope, comp.name, [...stack, comp.name], { ...route, resolveLocal });
    } else {
      this.walkStatement(comp.body, scope, comp.name, [...stack, comp.name]);
    }
  }

  // --- local helper functions --------------------------------------------

  /**
   * Enter a list-iteration callback (`nodes.map(cb)`), binding the element graph
   * value to the callback's first parameter. Three statically-analyzable shapes:
   *  - inline arrow/function with an identifier param (`(p) => …`) — reads attribute
   *    to the CURRENT component;
   *  - inline arrow/function with a destructured param (`({ title }) => …`) — each
   *    bound name reads the field off the element;
   *  - a function reference (`nodes.map(renderRow)`) — resolved like a helper
   *    (local or imported), reads attributed to the callback's own name.
   * Returns false when the callback isn't one of these (caller emits
   * `unsupported-list-flow` — silence would under-fetch).
   */
  private enterListCallback(
    cb: ts.Expression,
    element: GraphValue,
    scope: Scope,
    component: string,
    stack: readonly string[],
    route?: RouteCtx,
  ): boolean {
    if (this.ast.isArrowFunction(cb) || this.ast.isFunctionExpression(cb)) {
      const param = cb.parameters[0]?.name;
      if (!param) return false;
      // Bind (and afterwards restore) the param names in the CURRENT scope, so
      // sibling bindings in the callback body keep resolving.
      const restore: Array<readonly [string, GraphValue | undefined]> = [];
      const bind = (name: string, value: GraphValue): void => {
        restore.push([name, scope.graphVars.get(name)]);
        scope.graphVars.set(name, value);
      };
      let bound = false;
      if (this.ast.isIdentifier(param)) {
        bind(param.text, element);
        bound = true;
      } else if (this.ast.isObjectBindingPattern(param)) {
        // Destructured element: `({ title, handle }) => …` — each name IS a field read.
        bound = this.bindDestructured(param, element, component, bind);
      }
      if (!bound) return false;
      // A block body may bind intermediates (`const price = p.priceRange.min…`)
      // and read off them — walk it so those bindings are tracked; an
      // expression body just scans for reads.
      if (this.ast.isBlock(cb.body)) this.walkStatement(cb.body, scope, component, stack, route);
      else this.scan(cb.body, scope, component, stack, route);
      for (const [name, prev] of restore.reverse()) {
        if (prev) scope.graphVars.set(name, prev);
        else scope.graphVars.delete(name);
      }
      return true;
    }

    // Function reference: `nodes.map(renderRow)` — enter it like a helper call.
    if (this.ast.isIdentifier(cb)) {
      const fn = this.resolveFunction(cb);
      if (!fn || !fn.body) return false;
      const frame = `helper:${fn.name}`;
      if (stack.includes(frame)) return false; // guard against (mutual) recursion
      const param = fn.params[0]?.name;
      if (!param) return false;
      const inner: Scope = {
        graphVars: new Map(),
        componentVars: scope.componentVars,
        registries: scope.registries,
        accessors: this.graphAccessorNames(fn.body),
      };
      let bound = false;
      if (this.ast.isIdentifier(param)) {
        inner.graphVars.set(param.text, element);
        bound = true;
      } else if (this.ast.isObjectBindingPattern(param)) {
        bound = this.bindDestructured(param, element, fn.name, (name, child) => inner.graphVars.set(name, child));
      }
      if (!bound) return false;
      this.ensureReadMap(fn.name);
      const newStack = [...stack, frame];
      if (this.ast.isBlock(fn.body)) this.walkStatement(fn.body, inner, fn.name, newStack, route);
      else this.scan(fn.body, inner, fn.name, newStack, route);
      return true;
    }

    return false;
  }

  private tryEnterHelper(
    node: ts.CallExpression,
    scope: Scope,
    component: string,
    stack: readonly string[],
    route?: RouteCtx,
  ): boolean {
    const callee = node.expression;
    if (!this.ast.isIdentifier(callee)) return false;

    // Resolve positional graph-value arguments (skip inline callbacks).
    const argValues = node.arguments.map((arg) =>
      this.ast.isArrowFunction(arg) || this.ast.isFunctionExpression(arg)
        ? undefined
        : this.evalExpr(arg, scope, component, stack, route),
    );
    if (!argValues.some(Boolean)) return false;

    const fn = this.resolveFunction(callee);
    if (!fn || !fn.body) return false;
    const frame = `helper:${fn.name}`;
    if (stack.includes(frame)) return false; // guard against (mutual) recursion

    const inner: Scope = {
      graphVars: new Map(),
      componentVars: scope.componentVars,
      registries: scope.registries,
      accessors: this.graphAccessorNames(fn.body),
    };
    let bound = false;
    fn.params.forEach((param, i) => {
      const gv = argValues[i];
      if (!gv) return;
      if (this.ast.isIdentifier(param.name)) {
        inner.graphVars.set(param.name.text, {
          typeName: gv.typeName,
          sel: gv.sel,
          isList: gv.isList,
          readBase: gv.typeName,
          readPath: [],
        });
        bound = true;
      } else if (this.ast.isObjectBindingPattern(param.name)) {
        // Destructured parameter: formatProduct({ title, vendor }) { ... }
        bound =
          this.bindDestructured(param.name, gv, fn.name, (name, child) => inner.graphVars.set(name, child)) || bound;
      }
    });
    if (!bound) return false;

    this.consumed.add(node);
    this.ensureReadMap(fn.name);
    const newStack = [...stack, frame];
    if (this.ast.isBlock(fn.body)) this.walkStatement(fn.body, inner, fn.name, newStack, route);
    else this.scan(fn.body, inner, fn.name, newStack, route); // arrow expression body
    return true;
  }

  /** Resolve an identifier callee to a function/arrow declaration (local or imported). */
  private resolveFunction(
    id: ts.Identifier,
  ): { name: string; params: ts.NodeArray<ts.ParameterDeclaration>; body: ts.Node | undefined } | undefined {
    const decl = this.backend.resolveDeclaration(id);
    if (!decl) return undefined;
    if (this.ast.isFunctionDeclaration(decl) && decl.body) {
      return { name: decl.name?.text ?? id.text, params: decl.parameters, body: decl.body };
    }
    if (
      this.ast.isVariableDeclaration(decl) &&
      decl.initializer &&
      (this.ast.isArrowFunction(decl.initializer) || this.ast.isFunctionExpression(decl.initializer))
    ) {
      const name = this.ast.isIdentifier(decl.name) ? decl.name.text : id.text;
      return { name, params: decl.initializer.parameters, body: decl.initializer.body };
    }
    return undefined;
  }

  // --- component / registry resolution -----------------------------------

  private resolveTag(tag: ts.Identifier, scope: Scope): ComponentResolution {
    const local = scope.componentVars.get(tag.text);
    if (local) return local;
    const byName = this.componentsByName.get(tag.text);
    if (byName) return { kind: "components", candidates: [byName] };
    const info = this.resolveImportedComponent(tag);
    if (info) return { kind: "components", candidates: [info] };
    return { kind: "unresolved" };
  }

  /**
   * Resolve a component referenced by identifier to its declaration — which may
   * live in another module. Prop-flow and read extraction then continue into
   * that component's body, so components can be split across files.
   */
  private resolveImportedComponent(tag: ts.Identifier): ComponentInfo | undefined {
    const decl = this.backend.resolveDeclaration(tag);
    if (!decl) return undefined;
    return this.componentsByDecl.get(decl) ?? this.componentFromDecl(decl);
  }

  /** Build (and cache) a ComponentInfo from a function/arrow declaration node. */
  private componentFromDecl(decl: ts.Declaration): ComponentInfo | undefined {
    let info: ComponentInfo | undefined;
    if (this.ast.isFunctionDeclaration(decl) && decl.name && decl.body) {
      info = { name: decl.name.text, params: decl.parameters, body: decl.body, declNode: decl };
    } else if (
      this.ast.isVariableDeclaration(decl) &&
      this.ast.isIdentifier(decl.name) &&
      decl.initializer &&
      (this.ast.isArrowFunction(decl.initializer) || this.ast.isFunctionExpression(decl.initializer))
    ) {
      info = { name: decl.name.text, params: decl.initializer.parameters, body: decl.initializer.body, declNode: decl };
    }
    if (info) {
      this.componentsByDecl.set(decl, info);
      if (!this.componentsByName.has(info.name)) this.componentsByName.set(info.name, info);
    }
    return info;
  }

  private resolveComponentExpr(expr: ts.Expression, scope: Scope): ComponentResolution | undefined {
    if (this.ast.isParenthesizedExpression(expr)) return this.resolveComponentExpr(expr.expression, scope);
    if (this.ast.isIdentifier(expr)) {
      const info = this.componentsByName.get(expr.text) ?? this.resolveImportedComponent(expr);
      return info ? { kind: "components", candidates: [info] } : undefined;
    }
    if (this.ast.isConditionalExpression(expr)) {
      const a = this.resolveComponentExpr(expr.whenTrue, scope);
      const b = this.resolveComponentExpr(expr.whenFalse, scope);
      if (a?.kind === "components" && b?.kind === "components") {
        return { kind: "components", candidates: [...a.candidates, ...b.candidates] };
      }
      return undefined;
    }
    if (this.ast.isElementAccessExpression(expr) && this.ast.isIdentifier(expr.expression)) {
      const registry = scope.registries.get(expr.expression.text) ?? this.globalRegistries.get(expr.expression.text);
      if (registry) {
        const arg = expr.argumentExpression;
        if (this.ast.isStringLiteralLike(arg)) {
          const one = registry.find((c) => c.name === arg.text);
          if (one) return { kind: "components", candidates: [one] };
        }
        return { kind: "components", candidates: registry };
      }
    }
    return undefined;
  }

  private resolveRegistry(call: ts.CallExpression): readonly ComponentInfo[] {
    const arg = call.arguments[0];
    const out: ComponentInfo[] = [];
    if (arg && this.ast.isObjectLiteralExpression(arg)) {
      for (const prop of arg.properties) {
        if (this.ast.isPropertyAssignment(prop) && this.ast.isIdentifier(prop.initializer)) {
          const info = this.componentsByName.get(prop.initializer.text);
          if (info) out.push(info);
        } else if (this.ast.isShorthandPropertyAssignment(prop)) {
          const info = this.componentsByName.get(prop.name.text);
          if (info) out.push(info);
        }
      }
    }
    return out;
  }

  // --- roots / args ------------------------------------------------------

  private createRoot(call: ts.CallExpression, route: RouteCtx, accessors: ReadonlySet<string>): GraphValue | undefined {
    const rootName = this.graphRootName(call, accessors);
    if (!rootName) return undefined;
    const def = this.schema.getRootField(rootName);
    if (!def) return undefined;

    const argMap: Array<readonly [string, ArgValue]> = [];
    const argObj = call.arguments[0];
    if (argObj && this.ast.isObjectLiteralExpression(argObj)) {
      for (const prop of argObj.properties) {
        const { argName, valueExpr } = this.argEntry(prop);
        if (!argName || !valueExpr) continue;
        const argType = def.args?.find((a) => a.name === argName)?.type ?? "String!";
        const value = route.vars.lift(rootName, argName, argType, valueExpr, route.resolveLocal);
        argMap.push([argName, value]);
      }
    }
    const key = canonicalArgs(argMap);
    const field = route.rootSel.field(rootName, key, () => ({
      name: rootName,
      key,
      args: argMap,
      child: new MutableSelection(def.type),
    }));
    return {
      typeName: def.type,
      sel: field.child!,
      isList: def.list ?? false,
      readBase: def.type,
      readPath: [],
    };
  }

  private argEntry(prop: ts.ObjectLiteralElementLike): {
    argName?: string;
    valueExpr?: ts.Expression;
  } {
    if (this.ast.isPropertyAssignment(prop) && this.ast.isIdentifier(prop.name)) {
      return { argName: prop.name.text, valueExpr: prop.initializer };
    }
    if (this.ast.isShorthandPropertyAssignment(prop)) {
      return { argName: prop.name.text, valueExpr: prop.name };
    }
    return {};
  }

  private parseArgs(node: ts.Expression | undefined): ArgMap | undefined {
    if (!node || !this.ast.isObjectLiteralExpression(node)) return undefined;
    const entries: Array<readonly [string, ArgValue]> = [];
    for (const prop of node.properties) {
      if (this.ast.isPropertyAssignment(prop) && this.ast.isIdentifier(prop.name)) {
        const v = this.parseArgValue(prop.initializer);
        if (v) entries.push([prop.name.text, v]);
      }
    }
    return entries.length > 0 ? entries : [];
  }

  private parseArgValue(node: ts.Expression): ArgValue | undefined {
    if (this.ast.isNumericLiteral(node)) return { kind: "literal", value: Number(node.text) };
    if (this.ast.isStringLiteralLike(node)) return { kind: "literal", value: node.text };
    if (node.kind === this.ast.kind.TrueKeyword) return { kind: "literal", value: true };
    if (node.kind === this.ast.kind.FalseKeyword) return { kind: "literal", value: false };
    if (node.kind === this.ast.kind.NullKeyword) return { kind: "literal", value: null };
    if (this.ast.isObjectLiteralExpression(node)) {
      const fields: Array<readonly [string, ArgValue]> = [];
      for (const prop of node.properties) {
        if (this.ast.isPropertyAssignment(prop) && this.ast.isIdentifier(prop.name)) {
          const v = this.parseArgValue(prop.initializer);
          if (v) fields.push([prop.name.text, v]);
        }
      }
      return { kind: "object", fields };
    }
    if (this.ast.isArrayLiteralExpression(node)) {
      const items = node.elements.map((e) => this.parseArgValue(e)).filter((v): v is ArgValue => !!v);
      return { kind: "list", items };
    }
    return undefined;
  }

  // --- helpers -----------------------------------------------------------

  private graphRootName(call: ts.CallExpression, accessors: ReadonlySet<string>): string | undefined {
    const callee = call.expression;
    if (!this.ast.isPropertyAccessExpression(callee)) return undefined;
    const obj = callee.expression;
    // The accessor is either a known identifier (the imported `glean` or a
    // `useGlean()` local) or a direct inline `useGlean().root(...)` call.
    const isAccessor =
      (this.ast.isIdentifier(obj) && accessors.has(obj.text)) || this.isUseGraphCall(obj);
    if (!isAccessor) return undefined;
    const name = callee.name.text;
    return this.schema.getRootField(name) ? name : undefined;
  }

  /**
   * Identifiers that hold the graph accessor inside `body`: the imported `glean`
   * (by convention) plus any local bound to `useGlean()` — so an island can name it
   * anything (`const g = useGlean(); g.product(...)`). A lexical scan (no
   * type-checker), so it behaves identically across the `typescript` and tsgo engines.
   */
  private graphAccessorNames(body: ts.Node | undefined): Set<string> {
    const names = new Set<string>(["glean"]);
    if (!body) return names;
    const visit = (node: ts.Node): void => {
      if (
        this.ast.isVariableDeclaration(node) &&
        this.ast.isIdentifier(node.name) &&
        node.initializer &&
        this.isUseGraphCall(node.initializer)
      ) {
        names.add(node.name.text);
      }
      this.ast.forEachChild(node, visit);
    };
    visit(body);
    return names;
  }

  private isUseGraphCall(expr: ts.Expression): boolean {
    let e: ts.Node = expr;
    while (this.ast.isParenthesizedExpression(e) || this.ast.isNonNullExpression(e)) e = e.expression;
    return this.ast.isCallExpression(e) && this.ast.isIdentifier(e.expression) && e.expression.text === "useGlean";
  }

  private isGraphComponents(call: ts.CallExpression): boolean {
    const callee = call.expression;
    return (
      this.ast.isPropertyAccessExpression(callee) &&
      this.ast.isIdentifier(callee.expression) &&
      callee.expression.text === "glean" &&
      callee.name.text === "components"
    );
  }

  private detectTypenameNarrow(
    expr: ts.Expression,
    scope: Scope,
  ): { varName: string; gv: GraphValue; typeName: string } | undefined {
    if (!this.ast.isBinaryExpression(expr)) return undefined;
    if (expr.operatorToken.kind !== this.ast.kind.EqualsEqualsEqualsToken) return undefined;
    const pairs: Array<[ts.Expression, ts.Expression]> = [
      [expr.left, expr.right],
      [expr.right, expr.left],
    ];
    for (const [access, literal] of pairs) {
      if (
        this.ast.isPropertyAccessExpression(access) &&
        access.name.text === "__typename" &&
        this.ast.isIdentifier(access.expression) &&
        this.ast.isStringLiteralLike(literal)
      ) {
        const gv = scope.graphVars.get(access.expression.text);
        if (gv && this.schema.isUnionOrInterface(gv.typeName)) {
          return { varName: access.expression.text, gv, typeName: literal.text };
        }
      }
    }
    return undefined;
  }

  private graphProps(comp: ComponentInfo): Array<{ localName: string; typeName: string }> {
    const out: Array<{ localName: string; typeName: string }> = [];
    const param = comp.params[0];
    if (!param) return out;
    if (this.ast.isObjectBindingPattern(param.name)) {
      for (const element of param.name.elements) {
        if (!this.ast.isIdentifier(element.name)) continue;
        const typeName = this.propGraphType(param, element.name.text, element.name);
        if (typeName) out.push({ localName: element.name.text, typeName });
      }
    } else if (this.ast.isIdentifier(param.name)) {
      const typeName = this.propGraphType(param, param.name.text, param.name);
      if (typeName) out.push({ localName: param.name.text, typeName });
    }
    return out;
  }

  private propGraphType(param: ts.ParameterDeclaration, localName: string, idNode: ts.Identifier): string | undefined {
    // Prefer the declared type name from the AST (handles union names directly).
    const declared = this.declaredTypeName(param.type, localName);
    if (declared && this.schema.getType(declared)) return declared;
    // Fall back to the type checker's brand.
    const names = this.backend.getGraphTypeNames(idNode);
    if (!names) return undefined;
    if (names.length === 1) return names[0];
    return this.matchUnion(names);
  }

  private declaredTypeName(typeNode: ts.TypeNode | undefined, localName: string): string | undefined {
    if (!typeNode) return undefined;
    if (this.ast.isTypeLiteralNode(typeNode)) {
      for (const member of typeNode.members) {
        if (
          this.ast.isPropertySignature(member) &&
          member.name &&
          this.ast.isIdentifier(member.name) &&
          member.name.text === localName &&
          member.type
        ) {
          return this.typeRefName(member.type);
        }
      }
    }
    return undefined;
  }

  private typeRefName(typeNode: ts.TypeNode): string | undefined {
    if (this.ast.isTypeReferenceNode(typeNode) && this.ast.isIdentifier(typeNode.typeName)) {
      return typeNode.typeName.text;
    }
    if (this.ast.isUnionTypeNode(typeNode)) {
      for (const t of typeNode.types) {
        const name = this.typeRefName(t);
        if (name && this.schema.getType(name)) return name;
      }
    }
    return undefined;
  }

  private matchUnion(names: readonly string[]): string | undefined {
    const set = new Set(names);
    // Search schema unions whose possibleTypes match the member set.
    // (SchemaModel does not expose iteration, so we probe known names.)
    for (const name of names) {
      const possible = this.schema.possibleTypes(name);
      if (possible.length > 1 && possible.every((p) => set.has(p)) && possible.length === set.size) {
        return name;
      }
    }
    return undefined;
  }

  private routeParamNames(comp: ComponentInfo): string[] {
    const param = comp.params[0];
    if (!param) return [];
    if (this.ast.isObjectBindingPattern(param.name)) {
      return param.name.elements
        .map((e) => (this.ast.isIdentifier(e.name) ? e.name.text : undefined))
        .filter((n): n is string => !!n);
    }
    if (this.ast.isIdentifier(param.name)) return [param.name.text];
    return [];
  }

  private resolveRouteLocal(comp: ComponentInfo, name: string): { name: string; init: ts.Expression } | undefined {
    let found: { name: string; init: ts.Expression } | undefined;
    const visit = (node: ts.Node): void => {
      if (found) return;
      if (
        this.ast.isVariableDeclaration(node) &&
        this.ast.isIdentifier(node.name) &&
        node.name.text === name &&
        node.initializer
      ) {
        found = { name, init: node.initializer };
        return;
      }
      this.ast.forEachChild(node, visit);
    };
    if (comp.body) visit(comp.body);
    return found;
  }

  private isJsx(node: ts.Node): boolean {
    return this.ast.isJsxElement(node) || this.ast.isJsxSelfClosingElement(node) || this.ast.isJsxFragment(node);
  }

  /** A fresh empty scope, seeded with the graph accessors visible in `body`. */
  private newScope(body: ts.Node | undefined): Scope {
    return {
      graphVars: new Map(),
      componentVars: new Map(),
      registries: new Map(),
      accessors: this.graphAccessorNames(body),
    };
  }

  /** The source field a binding element reads — its `propertyName` (renamed `{ a: b }`) or its own name. */
  private bindingFieldName(element: ts.BindingElement): string | undefined {
    if (!this.ast.isIdentifier(element.name)) return undefined;
    return element.propertyName && this.ast.isIdentifier(element.propertyName)
      ? element.propertyName.text
      : element.name.text;
  }

  /**
   * Bind every identifier element of an object-binding pattern (`{ title, vendor }`)
   * to a field read off `base`, routing each resolved child value through `set`.
   * Leaf reads record immediately (no child) — shared by destructuring declarations,
   * destructured helper/list-callback params. Returns whether any element was processed
   * (callers treat that as "parameter bound").
   */
  private bindDestructured(
    pattern: ts.ObjectBindingPattern,
    base: GraphValue,
    component: string,
    set: (localName: string, value: GraphValue) => void,
  ): boolean {
    let bound = false;
    for (const element of pattern.elements) {
      const field = this.bindingFieldName(element);
      if (field === undefined) continue;
      const child = this.readField(base, field, undefined, component);
      if (child && this.ast.isIdentifier(element.name)) set(element.name.text, child);
      bound = true; // leaf reads record immediately; only object fields re-bind
    }
    return bound;
  }

  private recordRead(component: string, path: string): void {
    const list = this.ensureReadMap(component);
    if (!list.includes(path)) list.push(path);
  }

  private ensureReadMap(component: string): string[] {
    let list = this.readMap.get(component);
    if (!list) {
      list = [];
      this.readMap.set(component, list);
    }
    return list;
  }

  private toReadMap(): ReadMap {
    const out: Record<string, readonly string[]> = {};
    for (const [k, v] of this.readMap) {
      if (v.length > 0) out[k] = [...v];
    }
    return out;
  }

  private computeStats(selection: SelectionSet): OperationArtifact["stats"] {
    let fieldCount = 0;
    let connectionCount = 0;
    const walk = (set: SelectionSet): void => {
      for (const f of set.fields) {
        fieldCount++;
        if (f.selection) {
          if (/Connection$/.test(f.selection.typeName)) connectionCount++;
          walk(f.selection);
        }
      }
      for (const frag of set.inlineFragments ?? []) walk(frag.selection);
    };
    walk(selection);
    return { fieldCount, rootCount: selection.fields.length, connectionCount };
  }

  private addDiagnostic(code: DiagnosticCode, message: string, node: ts.Node): void {
    const line = this.ast.line(this.sf, node);
    if (this.diagnostics.some((d) => d.code === code && d.message === message)) return;
    this.diagnostics.push({ code, message, line });
  }
}

interface RouteCtx {
  readonly rootSel: MutableSelection;
  readonly vars: VariablesBuilder;
  readonly resolveLocal: (name: string) => { name: string; init: ts.Expression } | undefined;
}

