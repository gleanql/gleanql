import ts from "typescript";
import fs from "node:fs";
import path from "node:path";
import { type BackendOptions, type BackendSession, type GraphCompilerBackend, registerBackend } from "./backend.js";

/**
 * Dev-mode incremental session state. Holds a SourceFile cache (keyed on path +
 * mtime) and the previous `ts.Program`, so a re-analysis after a single-file
 * edit reuses every unchanged SourceFile — including the multi-megabyte
 * lib.*.d.ts files and the static schema support modules — and re-binds/re-checks
 * only the edited route and its dependents. Without this, every keystroke-driven
 * regenerate rebuilds the whole program from scratch (the dominant HMR cost).
 *
 * Lifetime = the dev server. INTERNAL — exposed to callers only as the opaque
 * {@link BackendSession} so `ts.*` types never leak into the public `.d.ts`.
 */
interface TsSessionState {
  sourceFiles: Map<string, { version: string; file: ts.SourceFile }>;
  lastProgram?: ts.Program;
  signature?: string;
}

export function createBackendSession(): BackendSession {
  const state: TsSessionState = { sourceFiles: new Map() };
  return state;
}

function fileVersion(fileName: string): string {
  try {
    return String(fs.statSync(fileName).mtimeMs);
  } catch {
    return "0";
  }
}

/**
 * A CompilerHost that serves SourceFiles from the session cache when the file's
 * mtime is unchanged (reference-equal, so `oldProgram` reuse kicks in), and
 * re-parses + re-caches only changed files.
 */
function cachingHost(options: ts.CompilerOptions, session: TsSessionState): ts.CompilerHost {
  const base = ts.createCompilerHost(options, /* setParentNodes */ true);
  const baseGetSourceFile = base.getSourceFile.bind(base);
  base.getSourceFile = (fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile) => {
    const version = fileVersion(fileName);
    const cached = session.sourceFiles.get(fileName);
    if (cached && cached.version === version && !shouldCreateNewSourceFile) {
      return cached.file;
    }
    const file = baseGetSourceFile(fileName, languageVersionOrOptions, onError, shouldCreateNewSourceFile);
    if (file) session.sourceFiles.set(fileName, { version, file });
    else session.sourceFiles.delete(fileName);
    return file;
  };
  return base;
}

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

  constructor(options: TsBackendOptions, session?: BackendSession) {
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
    if (session) {
      // Incremental dev build: a stable root set + options means the previous
      // program can be reused as `oldProgram` — TS keeps the bound/checked
      // state of every SourceFile the caching host returns unchanged, so only
      // the edited file (and its dependents) are re-checked. A changed root set
      // or options invalidates the program (the cached SourceFiles still serve).
      // `session` is opaque to callers (BackendSession); only this backend that
      // produced it via createBackendSession() knows its real shape.
      const state = session as TsSessionState;
      const signature = JSON.stringify({ rootNames, paths: compilerOptions.paths, baseUrl: compilerOptions.baseUrl });
      const oldProgram = state.signature === signature ? state.lastProgram : undefined;
      const host = cachingHost(compilerOptions, state);
      this.program = ts.createProgram({ rootNames, options: compilerOptions, host, oldProgram });
      state.lastProgram = this.program;
      state.signature = signature;
    } else {
      this.program = ts.createProgram({ rootNames, options: compilerOptions });
    }
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

// The in-process `typescript` engine — the default backend. A BackendSession
// (dev only) enables incremental program reuse across regenerations.
registerBackend("typescript", (options, session) => new TsBackend(options, session));
