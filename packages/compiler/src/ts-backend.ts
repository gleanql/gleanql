import ts from "typescript";
import path from "node:path";
import { type BackendOptions, type GraphCompilerBackend, registerBackend } from "./backend.js";

/** Copy caller paths into the mutable `string[]` shape `ts.CompilerOptions` wants. */
function mutablePaths(
  paths: Readonly<Record<string, readonly string[]>> | undefined,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(paths ?? {})) out[key] = [...value];
  return out;
}

/**
 * Construction inputs for {@link TsBackend}. Identical to the engine-agnostic
 * {@link BackendOptions}; the `paths`/`baseUrl` entries let the compiler resolve
 * a consuming app's import aliases (e.g. `"@/*"`) on top of the built-in
 * `~/graph` mappings — the Vite plugin feeds in the app's `tsconfig` `paths`.
 */
export type TsBackendOptions = BackendOptions;

/**
 * v1 backend: a real `ts.Program` + `TypeChecker`. Graph-backed types are
 * recognized by a literal `__typename` property (the GraphQL `__typename` of an
 * object is a string-literal of its type name), so no special branding symbol
 * is needed in userland — schema types look like ordinary interfaces.
 */
export class TsBackend implements GraphCompilerBackend {
  private readonly program: ts.Program;
  private readonly checker: ts.TypeChecker;

  constructor(options: TsBackendOptions) {
    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      jsx: ts.JsxEmit.Preserve,
      strict: false,
      noEmit: true,
      skipLibCheck: true,
      baseUrl: options.baseUrl ?? options.supportDir,
      // Built-in `~/graph` mappings are absolute so they hold regardless of the
      // chosen `baseUrl`; caller-supplied app aliases (e.g. `@/*`) merge on top.
      paths: {
        "~/graph": [path.join(options.supportDir, "graph.ts")],
        "~/graph/schema": [path.join(options.supportDir, "schema.ts")],
        ...mutablePaths(options.paths),
      },
    };
    const rootNames = [
      ...options.fileNames,
      path.join(options.supportDir, "graph.ts"),
      path.join(options.supportDir, "schema.ts"),
    ];
    this.program = ts.createProgram({ rootNames, options: compilerOptions });
    this.checker = this.program.getTypeChecker();
  }

  getSourceFile(fileName: string): ts.SourceFile | undefined {
    return this.program.getSourceFile(fileName);
  }

  getGraphTypeNames(node: ts.Node): readonly string[] | undefined {
    const type = this.checker.getTypeAtLocation(node);
    return this.graphTypeNamesOfType(type);
  }

  getGraphTypeName(node: ts.Node): string | undefined {
    const names = this.getGraphTypeNames(node);
    return names && names.length === 1 ? names[0] : undefined;
  }

  isGraphBackedType(node: ts.Node): boolean {
    return this.getGraphTypeNames(node) !== undefined;
  }

  resolveDeclaration(node: ts.Node): ts.Declaration | undefined {
    let symbol = this.checker.getSymbolAtLocation(node);
    if (!symbol) return undefined;
    if (symbol.flags & ts.SymbolFlags.Alias) {
      symbol = this.checker.getAliasedSymbol(symbol);
    }
    return symbol.valueDeclaration ?? symbol.declarations?.[0];
  }

  private graphTypeNamesOfType(type: ts.Type): readonly string[] | undefined {
    const constituents = type.isUnion() ? type.types : [type];
    const names = new Set<string>();
    let sawGraph = false;
    for (const c of constituents) {
      if (c.flags & (ts.TypeFlags.Null | ts.TypeFlags.Undefined | ts.TypeFlags.Void)) continue;
      const typenameSym = this.checker.getPropertyOfType(c, "__typename");
      if (!typenameSym) continue;
      const decl = typenameSym.valueDeclaration ?? typenameSym.declarations?.[0];
      const tnType = decl
        ? this.checker.getTypeOfSymbolAtLocation(typenameSym, decl)
        : (typenameSym as unknown as { type?: ts.Type }).type;
      for (const literal of this.stringLiterals(tnType)) {
        names.add(literal);
        sawGraph = true;
      }
    }
    return sawGraph ? [...names] : undefined;
  }

  private stringLiterals(type: ts.Type | undefined): string[] {
    if (!type) return [];
    if (type.isUnion()) return type.types.flatMap((t) => this.stringLiterals(t));
    if (type.isStringLiteral()) return [type.value];
    return [];
  }
}

// The in-process `typescript` engine — the default backend.
registerBackend("typescript", (options) => new TsBackend(options));
