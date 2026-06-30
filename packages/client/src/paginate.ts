import {
  printOperation,
  type ArgMap,
  type ArgValue,
  type FieldSelection,
  type SelectionSet,
  type SchemaModel,
  type VariableDef,
} from "@gleanql/core";
import {
  selectionOf,
  trailOf,
  responseKeyCandidates,
  toArgMap,
  createGraphProxy,
  type FieldValue,
  type GraphClientAdapter,
  type GraphPagePointer,
  type GraphRef,
  type GraphRequestContext,
  type PathStep,
  errorMessage,
} from "./index.js";
import type { GraphRuntime } from "./runtime.js";

/**
 * `usePaginated` query-building + merge — the pure core of connection pagination,
 * plus the component-slice query builder `refresh({ component })` uses. No React
 * here; the hooks in `glue-client.ts` are thin wrappers. Glean bakes in NO pagination
 * convention: you read whatever `pageInfo`/cursor fields you want and the compiler
 * includes exactly those, so the page query is rebuilt from the connection's own
 * compiled selection.
 */

/** Helpers handed to a `merge` callback for combining a connection's node lists. */
export interface MergeHelpers {
  /** Existing node values (graph proxies) already in the list. */
  readonly existing: readonly unknown[];
  /** Newly-fetched node values for this page. */
  readonly incoming: readonly unknown[];
  /** Stable de-dupe keeping first occurrence (e.g. `uniqBy(all, n => n.id)`). */
  uniqBy<T>(items: readonly T[], key: (item: T) => unknown): T[];
  /** Stable sort by a derived key. */
  sortBy<T>(items: readonly T[], key: (item: T) => number | string): T[];
}

export interface UsePaginatedOptions {
  /**
   * Combine the prior nodes with the freshly-fetched page into the new node list.
   * Defaults to plain concatenation (`[...existing, ...incoming]`). Use this for
   * de-dupe/sort, or any non-`nodes` connection shape.
   */
  readonly merge?: (helpers: MergeHelpers) => readonly unknown[];
}

export interface UsePaginatedResult {
  /** Fetch the next page; `args` override the connection field's arguments (e.g. `{ after }`). */
  fetchMore(args: Record<string, unknown>): Promise<boolean>;
  /** True while a `fetchMore` is in flight. */
  readonly isLoading: boolean;
  /** The last transport/error message from a failed `fetchMore`, if any. */
  readonly error?: string;
}

/**
 * Build a minimal operation that fetches only what `componentName` reads — its
 * compiled read-map (entity-rooted field paths like `"Product.views"`) pruned out
 * of `op`'s selection, keeping identity at each retained level and only the
 * variables the slice still uses. So an island refetches its own fields without
 * ever naming them. Returns `undefined` if the component isn't in the read-map.
 * Pure — exported for testing.
 */
export function buildComponentOperation(
  op: { name: string; document: string; selection?: SelectionSet; readMap?: Record<string, readonly string[]> },
  componentName: string,
): { name: string; kind: "query"; document: string } | undefined {
  const paths = op.readMap?.[componentName];
  if (!op.selection || !paths?.length) return undefined;
  const pruned = pruneByReadPaths(op.selection, paths);
  if (pruned.fields.length === 0) return undefined;
  const used = collectVarNames(pruned);
  const variables = parseVariableDefs(op.document).filter((v) => used.has(v.name));
  const name = `${op.name}_${componentName}`;
  return { name, kind: "query", document: printOperation({ kind: "query", name, variables, selection: pruned }) };
}

/** The minimal compiled-operation shape paginate needs. */
interface PageableOp {
  readonly name: string;
  readonly document: string;
  readonly selection?: SelectionSet;
}

/**
 * Execute a single deferred ("two-sweep") root read with args computed at the
 * render call-site, and seed the cache — the runtime half of the deferred-args
 * feature. Reuses the pagination machinery (`buildPageOperation` builds a
 * single-root operation from the compiled selection, turning the call-site args
 * into `$vars` with schema-derived types) but seeds the result as a fresh root
 * (`seedResult`) instead of appending a connection page. Pure — exported for
 * testing. The caller (the bound-graph deferred branch) wraps this in
 * `runtime.resolveRoot(...)` for Suspense de-dup + resume.
 */
export async function resolveDeferredRoot(params: {
  readonly op: PageableOp;
  readonly rootField: string;
  readonly args: Record<string, unknown>;
  readonly schema: SchemaModel;
  readonly adapter: GraphClientAdapter;
  readonly runtime: GraphRuntime;
  readonly context: GraphRequestContext;
}): Promise<{ ok: boolean; roots?: Record<string, FieldValue>; error?: string }> {
  const { op, rootField, args, schema, adapter, runtime, context } = params;
  const trail: PathStep[] = [{ name: rootField, args }];
  const built = buildPageOperation(op, trail, args, schema);
  if (!built) return { ok: false };

  let result;
  try {
    result = await adapter.execute({ name: built.name, kind: "query", document: built.document }, args, context);
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  if (result?.errors?.length) return { ok: false, error: result.errors[0]!.message };
  const roots = result?.data ? runtime.seedResult(result.data as Record<string, unknown>) : {};
  return { ok: true, roots };
}

/**
 * Split a deferred operation into the part that can be preloaded eagerly from
 * `ctx` and the set of root fields whose args are render-time (`runtimeVars`).
 * Returns a pruned eager op (only the non-deferred roots, with just the vars they
 * still use) — `undefined` when no eager roots remain (a pure two-sweep route) —
 * plus the deferred root field names. Pure — exported for testing.
 */
export function splitDeferredRoots(
  op: { name: string; document: string; selection?: SelectionSet },
  runtimeVars: ReadonlySet<string>,
): { eager?: { name: string; kind: "query"; document: string; selection: SelectionSet }; deferredRoots: Set<string> } {
  const deferredRoots = new Set<string>();
  const eagerFields: FieldSelection[] = [];
  for (const f of op.selection?.fields ?? []) {
    const vars = new Set<string>();
    for (const [, v] of f.args ?? []) collectArgValueVars(v, vars);
    if ([...vars].some((v) => runtimeVars.has(v))) deferredRoots.add(f.name);
    else eagerFields.push(f);
  }
  if (eagerFields.length === 0 || !op.selection) return { deferredRoots };

  const selection: SelectionSet = { typeName: op.selection.typeName, fields: eagerFields };
  const used = collectVarNames(selection);
  const variables = parseVariableDefs(op.document).filter((v) => used.has(v.name));
  const name = `${op.name}_eager`;
  return {
    eager: { name, kind: "query", document: printOperation({ kind: "query", name, variables, selection }), selection },
    deferredRoots,
  };
}

/** Variable names referenced in a single arg value (non-recursive into selections). */
function collectArgValueVars(v: ArgValue, out: Set<string>): void {
  if (v.kind === "var") out.add(v.name);
  else if (v.kind === "list") v.items.forEach((i) => collectArgValueVars(i, out));
  else if (v.kind === "object") v.fields.forEach(([, vv]) => collectArgValueVars(vv, out));
}

export interface PaginateConnectionParams {
  readonly connection: unknown;
  readonly args: Record<string, unknown>;
  readonly merge?: UsePaginatedOptions["merge"];
  readonly schema: SchemaModel;
  readonly operations: Record<string, PageableOp>;
  readonly adapter: GraphClientAdapter;
  readonly runtime: GraphRuntime;
  readonly page: GraphPagePointer;
}

/**
 * The non-hook core of `usePaginated`: rebuild the connection's query with the
 * caller's `args`, fetch it, and merge the page into the cache. Exported so it can
 * be tested without a React renderer (the hook is a thin wrapper that adds loading
 * state + a cache subscription).
 */
export async function paginateConnection(params: PaginateConnectionParams): Promise<{ ok: boolean; error?: string }> {
  const { connection, args, merge, schema, operations, adapter, runtime, page } = params;
  const sel = selectionOf(connection);
  const trail = trailOf(connection);
  if (!sel || !trail || trail.length === 0) return { ok: false };

  const op = operations[page.operationName];
  const built = op && buildPageOperation(op, trail, args, schema);
  if (!built) return { ok: false };

  let result;
  try {
    result = await adapter.execute(
      { name: built.name, kind: "query", document: built.document },
      { ...page.variables, ...args },
      page.context as GraphRequestContext,
    );
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  if (result?.errors?.length) return { ok: false, error: result.errors[0]!.message };

  const pageData = navigatePage(result?.data as Record<string, unknown> | undefined, trail);
  if (!pageData) return { ok: false };
  runtime.appendConnection(sel.ref, pageData, refMergeFor(merge, schema, sel.type, runtime));
  return { ok: true };
}

/** The op field whose response key matches a runtime path step (handles arg-aliasing). */
function pickStepField(fields: readonly FieldSelection[], step: PathStep): FieldSelection | undefined {
  const named = fields.filter((f) => f.name === step.name);
  if (named.length <= 1) return named[0];
  const keys = responseKeyCandidates(step.name, toArgMap(step.args));
  return named.find((f) => keys.includes(f.alias ?? f.name)) ?? named[0];
}

/** Replace/add args on the connection field, turning each caller arg into a `$var`. */
function withUserArgs(existing: ArgMap | undefined, args: Record<string, unknown>): ArgMap {
  const map = new Map<string, ArgValue>(existing ?? []);
  for (const name of Object.keys(args)) map.set(name, { kind: "var", name });
  return [...map.entries()];
}

/** Clone the single root→connection path out of `op`, overriding the connection's args. */
function clonePathField(
  parent: SelectionSet,
  trail: readonly PathStep[],
  depth: number,
  args: Record<string, unknown>,
): FieldSelection | undefined {
  const field = pickStepField(parent.fields, trail[depth]!);
  if (!field) return undefined;
  if (depth === trail.length - 1) return { ...field, args: withUserArgs(field.args, args) };
  if (!field.selection) return undefined;
  const child = clonePathField(field.selection, trail, depth + 1, args);
  if (!child) return undefined;
  const identity = field.selection.fields.filter((f) => !f.selection && (f.name === "__typename" || f.name === "id"));
  return { ...field, selection: { typeName: field.selection.typeName, fields: [...identity, child] } };
}

/** Walk the schema along `trail` to the connection field's declared arg types. */
function connectionArgTypes(trail: readonly PathStep[], schema: SchemaModel): Record<string, string> {
  let parentType: string | undefined = schema.queryType;
  let fieldDef;
  for (const step of trail) {
    if (!parentType) return {};
    fieldDef = schema.getField(parentType, step.name);
    parentType = fieldDef?.type;
  }
  const out: Record<string, string> = {};
  for (const a of fieldDef?.args ?? []) out[a.name] = a.type;
  return out;
}

/**
 * Build a query for the NEXT page of the connection at `trail`: the single path from
 * a Query root to it (with its full node/pageInfo selection), with the caller's
 * `args` overriding the connection field's arguments as `$vars`. Returns `undefined`
 * if the path isn't in the op. Pure — exported for testing.
 */
export function buildPageOperation(
  op: { name: string; document: string; selection?: SelectionSet },
  trail: readonly PathStep[],
  args: Record<string, unknown>,
  schema: SchemaModel,
): { name: string; kind: "query"; document: string } | undefined {
  if (!op.selection || trail.length === 0) return undefined;
  const pathField = clonePathField(op.selection, trail, 0, args);
  if (!pathField) return undefined;
  const selection: SelectionSet = { typeName: op.selection.typeName, fields: [pathField] };
  const used = collectVarNames(selection);
  const argTypes = connectionArgTypes(trail, schema);
  const headerVars = parseVariableDefs(op.document).filter((v) => used.has(v.name));
  const argVars: VariableDef[] = Object.keys(args).map((name) => ({ name, type: argTypes[name] ?? "String" }));
  const variables = dedupeVarsByName([...headerVars, ...argVars]);
  const name = `${op.name}_page`;
  return { name, kind: "query", document: printOperation({ kind: "query", name, variables, selection }) };
}

function dedupeVarsByName(vars: readonly VariableDef[]): VariableDef[] {
  const seen = new Map<string, VariableDef>();
  for (const v of vars) if (!seen.has(v.name)) seen.set(v.name, v);
  return [...seen.values()];
}

/** Walk a result's data along the runtime path to the connection object. */
function navigatePage(
  data: Record<string, unknown> | undefined,
  trail: readonly PathStep[],
): Record<string, unknown> | undefined {
  let cur: unknown = data;
  for (const step of trail) {
    if (cur == null || typeof cur !== "object") return undefined;
    const obj = cur as Record<string, unknown>;
    const keys = responseKeyCandidates(step.name, toArgMap(step.args));
    const key = keys.find((k) => k in obj) ?? step.name;
    cur = obj[key];
  }
  return cur && typeof cur === "object" ? (cur as Record<string, unknown>) : undefined;
}

/**
 * Adapt a user `merge` (which works on node *values* — graph proxies, so `n => n.id`
 * etc. read naturally) into the ref-level merge the cache stores. Wraps existing +
 * incoming node refs as proxies, runs the user merge, and maps the result back to
 * refs. Returns `undefined` (plain concat) when no merge was supplied.
 */
function refMergeFor(
  merge: UsePaginatedOptions["merge"],
  schema: SchemaModel,
  connectionType: string,
  runtime: GraphRuntime,
): ((existing: readonly unknown[], incoming: readonly unknown[]) => readonly unknown[]) | undefined {
  if (!merge) return undefined;
  const nodeType = schema.getField(connectionType, "nodes")?.type ?? "Unknown";
  const binding = { schema, getRuntime: () => runtime };
  const wrap = (ref: unknown): unknown => {
    if (ref && typeof ref === "object" && ("path" in ref || ("__typename" in ref && "id" in ref))) {
      const r = ref as GraphRef;
      return createGraphProxy(binding, r, (r.__typename as string | undefined) ?? nodeType);
    }
    return ref;
  };
  const unwrap = (value: unknown): unknown => selectionOf(value)?.ref ?? value;
  return (existing, incoming) => {
    const merged = merge({
      existing: existing.map(wrap),
      incoming: incoming.map(wrap),
      uniqBy: stableUniqBy,
      sortBy: stableSortBy,
    });
    return merged.map(unwrap);
  };
}

function stableUniqBy<T>(items: readonly T[], key: (item: T) => unknown): T[] {
  const seen = new Set<unknown>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(item);
    }
  }
  return out;
}

function stableSortBy<T>(items: readonly T[], key: (item: T) => number | string): T[] {
  return [...items]
    .map((item, i) => [item, i] as const)
    .sort((a, b) => {
      const ka = key(a[0]);
      const kb = key(b[0]);
      return ka < kb ? -1 : ka > kb ? 1 : a[1] - b[1];
    })
    .map(([item]) => item);
}

/**
 * Prune a root selection to the entity-rooted read-map `paths` (e.g.
 * `"Product.featuredImage.url"`). Root fields are kept when their entity type is
 * referenced; below the root, fields are kept when they're on a path (or an
 * ancestor of one), plus identity for normalization.
 */
function pruneByReadPaths(rootSel: SelectionSet, paths: readonly string[]): SelectionSet {
  const rootTypes = new Set(paths.map((p) => p.split(".")[0]));
  const fields: FieldSelection[] = [];
  for (const f of rootSel.fields) {
    if (f.selection && rootTypes.has(f.selection.typeName)) {
      fields.push({ ...f, selection: pruneEntity(f.selection, f.selection.typeName, paths) });
    }
  }
  return { typeName: rootSel.typeName, fields };
}

/** Prune an entity selection; `prefix` is the entity-rooted field path so far (e.g. `"Product"`). */
function pruneEntity(sel: SelectionSet, prefix: string, paths: readonly string[]): SelectionSet {
  const fields: FieldSelection[] = [];
  const seen = new Set<string>();
  const keep = (f: FieldSelection) => {
    const key = f.alias ?? f.name;
    if (!seen.has(key)) {
      seen.add(key);
      fields.push(f);
    }
  };
  for (const f of sel.fields) {
    if (!f.selection && (f.name === "__typename" || f.name === "id")) {
      keep(f); // identity, so the result normalizes back onto the entity
      continue;
    }
    const tp = `${prefix}.${f.name}`;
    if (paths.includes(tp)) keep(f); // exact read (scalar, or a whole object subtree)
    else if (f.selection && paths.some((p) => p.startsWith(`${tp}.`))) keep({ ...f, selection: pruneEntity(f.selection, tp, paths) });
  }
  return { typeName: sel.typeName, fields };
}

/** Names of operation variables referenced anywhere in a selection's arguments. */
function collectVarNames(sel: SelectionSet): Set<string> {
  const out = new Set<string>();
  const fromValue = (v: ArgValue) => {
    if (v.kind === "var") out.add(v.name);
    else if (v.kind === "list") v.items.forEach(fromValue);
    else if (v.kind === "object") v.fields.forEach(([, vv]) => fromValue(vv));
  };
  const fromArgs = (args?: ArgMap) => (args ?? []).forEach(([, v]) => fromValue(v));
  const walk = (s: SelectionSet) => {
    for (const f of s.fields) {
      fromArgs(f.args);
      if (f.selection) walk(f.selection);
    }
    for (const fr of s.inlineFragments ?? []) walk(fr.selection);
  };
  walk(sel);
  return out;
}

/** Parse `query Name($a: T!, $b: [U!])` → variable defs (operation header only). */
function parseVariableDefs(document: string): VariableDef[] {
  const m = /^\s*(?:query|mutation|subscription)\s+\w+\s*\(([^)]*)\)\s*\{/.exec(document);
  if (!m?.[1]) return [];
  return m[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const colon = s.indexOf(":");
      return { name: s.slice(0, colon).trim().replace(/^\$/, ""), type: s.slice(colon + 1).trim() };
    });
}
