export * from "./backend.js";
export * from "./ts-backend.js";
export * from "./ast-facade.js";
export * from "./diagnostics.js";
export * from "./analyzer.js";
export * from "./mutation-binding.js";
export * from "./selector-compile.js";

import { SchemaModel } from "@gleanql/core";
import {
  type BackendOptions,
  type GraphCompilerBackendFactory,
  createBackend,
} from "./backend.js";
import "./ts-backend.js"; // side effect: registers the default "typescript" backend
import { analyzeFile, type AnalyzeResult } from "./analyzer.js";

// The experimental tsgo engine. Statically safe to re-export: `@typescript/native-preview`
// is only ever loaded by a dynamic import inside `createTsgoBackend`/`analyzeWithTsgo`.
export { createTsgoBackend, analyzeWithTsgo, type AnalyzeWithTsgoOptions } from "./tsgo/index.js";

/** Which type engine to analyze with: a registered name, or a factory. */
export type BackendSelector = string | GraphCompilerBackendFactory;

export interface AnalyzeOptions {
  fileName: string;
  supportDir: string;
  schema: SchemaModel;
  extraFiles?: readonly string[];
  /** App import aliases (e.g. `{ "@/*": ["/abs/app/src/*"] }`), merged with `~/graph`. */
  paths?: Readonly<Record<string, readonly string[]>>;
  /** `baseUrl` for `paths`; defaults to `supportDir`. */
  baseUrl?: string;
  /** Type engine. Defaults to the in-process `"typescript"` backend. */
  backend?: BackendSelector;
}

/**
 * Build a backend over the given files + support modules and analyze one
 * entrypoint. The backend is selected by name (default `"typescript"`) or a
 * factory, so the type engine is swappable without touching analysis logic.
 * Framework adapters with a long-lived program can call `analyzeFile` directly.
 */
export function analyze(options: AnalyzeOptions): AnalyzeResult {
  const backendOptions: BackendOptions = {
    fileNames: [options.fileName, ...(options.extraFiles ?? [])],
    supportDir: options.supportDir,
    paths: options.paths,
    baseUrl: options.baseUrl,
  };
  const selector = options.backend ?? "typescript";
  const backend =
    typeof selector === "function" ? selector(backendOptions) : createBackend(selector, backendOptions);
  try {
    return analyzeFile({ fileName: options.fileName, backend, schema: options.schema });
  } finally {
    backend.dispose?.();
  }
}

/**
 * Back-compat alias for {@link analyze} pinned to the `typescript` backend.
 * Existing callers (tests, the Vite plugin) keep working unchanged.
 */
export function analyzeWithTs(options: Omit<AnalyzeOptions, "backend">): AnalyzeResult {
  return analyze({ ...options, backend: "typescript" });
}
