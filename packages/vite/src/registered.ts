import * as esbuild from "esbuild";
import path from "node:path";
import {
  hashDocument,
  printOperation,
  type OperationArtifact,
  type OperationIR,
  type SchemaModel,
  type SelectionSet,
} from "@gleanql/core";

/**
 * Registered operations: hand-built `buildQuery(...)` IR that ships like compiled
 * operations. The app points `glean({ operations: "./src/report-operations.ts" })`
 * at a module whose exports are `OperationIR`s; the build RUNS that module (its
 * shape must be deterministic at build time), prints + hashes each operation, and
 * folds them into the same `operations` map — so they ride the generated module,
 * the persisted manifest/allowlist, and the `/__glean` overlay exactly like
 * compiled ones. Execute at runtime with `runOperation(name, variables)`.
 */

export interface LoadRegisteredOptions {
  /** Import aliases for the bundle (tests point `@gleanql/core` at workspace source). */
  readonly alias?: Record<string, string>;
}

/** Structural check: does a module export look like an `OperationIR`? */
function isOperationIR(value: unknown): value is OperationIR {
  if (typeof value !== "object" || value === null) return false;
  const op = value as Partial<OperationIR>;
  return (
    (op.kind === "query" || op.kind === "mutation" || op.kind === "subscription") &&
    typeof op.name === "string" &&
    Array.isArray(op.variables) &&
    typeof op.selection === "object" &&
    op.selection !== null &&
    typeof op.selection.typeName === "string" &&
    Array.isArray(op.selection.fields)
  );
}

/**
 * The fluent builder is schema-free, so its selection sets carry empty
 * `typeName`s. Resolve them against the schema (walking field defs from the
 * operation root) so stats, devtools, and the generated result TYPES treat
 * registered operations exactly like compiled ones. Unknown fields keep `""`
 * and render as `unknown` downstream — never a wrong type.
 */
function resolveSelectionTypes(set: SelectionSet, typeName: string, schema: SchemaModel): SelectionSet {
  return {
    ...set,
    typeName,
    fields: set.fields.map((field) => {
      if (!field.selection) return field;
      const def = schema.getField(typeName, field.name);
      return { ...field, selection: resolveSelectionTypes(field.selection, def?.type ?? "", schema) };
    }),
    inlineFragments: set.inlineFragments?.map((frag) => ({
      ...frag,
      selection: resolveSelectionTypes(frag.selection, frag.onType, schema),
    })),
  };
}

/** The operation root type for a kind (query/mutation/subscription). */
function rootTypeOf(kind: OperationIR["kind"], schema: SchemaModel): string {
  if (kind === "mutation") return schema.mutationType ?? "";
  if (kind === "subscription") return schema.subscriptionType ?? "";
  return schema.queryType;
}

/** Same stat definitions the analyzer uses, so registered ops read identically in devtools. */
function computeStats(selection: SelectionSet): OperationArtifact["stats"] {
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

/**
 * Bundle + execute the app's operations module and turn every `OperationIR`
 * export into an `OperationArtifact`. Non-operation exports are ignored (the
 * module may export helpers); zero operations is an error (a misconfigured path
 * should fail loudly, not silently allowlist nothing).
 */
export async function loadRegisteredOperations(
  appRoot: string,
  modulePath: string,
  schema: SchemaModel,
  options: LoadRegisteredOptions = {},
): Promise<Record<string, OperationArtifact>> {
  const entry = path.resolve(appRoot, modulePath);
  const built = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    absWorkingDir: appRoot,
    logLevel: "silent",
    ...(options.alias ? { alias: options.alias } : {}),
  });
  const code = built.outputFiles[0]?.text ?? "";
  const mod = (await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`)) as Record<
    string,
    unknown
  >;

  const out: Record<string, OperationArtifact> = {};
  for (const value of Object.values(mod)) {
    if (!isOperationIR(value)) continue;
    if (out[value.name]) {
      throw new Error(`@gleanql/vite: ${modulePath} registers two operations named "${value.name}".`);
    }
    const document = printOperation(value);
    const selection = resolveSelectionTypes(value.selection, rootTypeOf(value.kind, schema), schema);
    out[value.name] = {
      name: value.name,
      kind: value.kind,
      document,
      hash: hashDocument(document),
      // Variables are supplied at the `runOperation(name, variables)` call site;
      // the factory is identity so the shared refetch path still works.
      variablesFactory: {
        exportName: `get${value.name}Variables`,
        source: `export function get${value.name}Variables(ctx) {\n  return ctx ?? {};\n}`,
      },
      readMap: {},
      selection,
      variableDefs: value.variables,
      source: modulePath,
      stats: computeStats(selection),
    };
  }
  if (Object.keys(out).length === 0) {
    throw new Error(`@gleanql/vite: ${modulePath} exports no operations (expected OperationIR exports, e.g. from buildQuery).`);
  }
  return out;
}

/** Fold registered operations into the compiled map; a name collision is a build error. */
export function addRegisteredOperations(
  target: Record<string, OperationArtifact>,
  registered: Record<string, OperationArtifact>,
): void {
  for (const [name, op] of Object.entries(registered)) {
    const existing = target[name];
    if (existing) {
      throw new Error(
        `@gleanql/vite: registered operation "${name}" collides with the compiled operation from ${existing.source ?? "a route"} — rename one of them.`,
      );
    }
    target[name] = op;
  }
}
