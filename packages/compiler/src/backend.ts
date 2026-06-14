import type ts from "typescript";

/**
 * Compiler backend seam.
 *
 * The analyzer walks the TypeScript AST (structural questions) but routes every
 * *type/symbol* question through this interface, so the type engine can be
 * swapped without touching analysis logic. v1 ships a `typescript`-based
 * backend (a real Program + TypeChecker). The long-term target is an official
 * TypeScript-Go / Corsa backend — note that engine can be implemented in Go and
 * exposed over the same surface; the analyzer would not change.
 *
 * Handles are intentionally `ts.*` for the v1 backend. A non-TS backend would
 * substitute its own node/type representations; the analyzer only relies on the
 * methods declared here plus the AST shape it is handed.
 */
export interface GraphCompilerBackend {
  /** Parsed source for a given absolute path (entrypoint analysis root). */
  getSourceFile(fileName: string): ts.SourceFile | undefined;

  /**
   * The GraphQL type names a node's static type can be, or undefined if the
   * node is not graph-backed. One name for an object type; multiple for a
   * union/interface (used for `__typename` narrowing). Null/undefined members
   * of the type are ignored (so `Image | null` -> ["Image"]).
   */
  getGraphTypeNames(node: ts.Node): readonly string[] | undefined;

  /** Convenience: single graph type name, or undefined if not exactly one. */
  getGraphTypeName(node: ts.Node): string | undefined;

  isGraphBackedType(node: ts.Node): boolean;

  /** Resolve an identifier / JSX tag to its value declaration node. */
  resolveDeclaration(node: ts.Node): ts.Declaration | undefined;

  /**
   * Release any resources held by the backend (e.g. a spawned type-engine
   * process). Optional — the in-process `typescript` backend needs nothing.
   */
  dispose?(): void;
}

/**
 * Inputs every backend is constructed from. The analyzer hands these to the
 * selected engine; what the engine does with them (a `ts.Program`, an out-of-
 * process checker, …) is its own business.
 */
export interface BackendOptions {
  /** Absolute paths to analyze (entrypoints / fixtures). */
  readonly fileNames: readonly string[];
  /** Directory containing the generated `graph` + `schema` support modules. */
  readonly supportDir: string;
  /** Extra module-path mappings (e.g. an app's `"@/*"`), merged with `~/graph`. */
  readonly paths?: Readonly<Record<string, readonly string[]>>;
  /** `baseUrl` for {@link paths}; defaults to {@link supportDir}. */
  readonly baseUrl?: string;
}

/**
 * An opaque, engine-specific incremental-build session (e.g. the TS backend's
 * cached program + SourceFiles). Created once per dev server and passed to every
 * `createBackend` call so the engine can reuse work across regenerations. The
 * core stays engine-agnostic — it only holds and forwards the handle.
 */
export type BackendSession = unknown;

/** Constructs a backend over the given inputs, optionally reusing a {@link BackendSession}. */
export type GraphCompilerBackendFactory = (
  options: BackendOptions,
  session?: BackendSession,
) => GraphCompilerBackend;

const registry = new Map<string, GraphCompilerBackendFactory>();

/**
 * Register a named type-engine backend. The built-in `typescript` backend
 * self-registers; alternative engines (e.g. a `tsgo` `--api` backend) register
 * themselves the same way, so callers select one by name without importing it.
 */
export function registerBackend(name: string, factory: GraphCompilerBackendFactory): void {
  registry.set(name, factory);
}

/** Names of all registered backends, in registration order. */
export function listBackends(): readonly string[] {
  return [...registry.keys()];
}

/** Construct a backend by name. Throws if the name was never registered. */
export function createBackend(
  name: string,
  options: BackendOptions,
  session?: BackendSession,
): GraphCompilerBackend {
  const factory = registry.get(name);
  if (!factory) {
    throw new Error(
      `Unknown compiler backend "${name}". Registered: ${listBackends().join(", ") || "(none)"}.`,
    );
  }
  return factory(options, session);
}
