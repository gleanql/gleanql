import type { RequestScope } from "../types.js";

// How a generated module resolves *this request's* active graph. The accessor
// (`genGeneratedJs`) wants a throwing resolver; the RSC server glue wants a
// nullable one (a no-op on non-graph routes). Both are driven by `requestScope`.

const PRELOAD_ERROR = "graph not preloaded — add the graph preload interruptor to this route";

/** `import { <name> } from "<from>";` for an app-provided request-scope resolver. */
function scopeImport(requestScope: Exclude<RequestScope, "rwsdk">): string {
  return `import { ${requestScope.import} } from ${JSON.stringify(requestScope.from)};`;
}

/** Per-scope import line + the expression yielding this request's graph (or undefined). */
function activeSource(requestScope: RequestScope): { readonly imports: string; readonly expr: string } {
  if (requestScope === "rwsdk") {
    return {
      imports: `import { requestInfo } from "rwsdk/worker";`,
      expr: "requestInfo && requestInfo.ctx && requestInfo.ctx.__graph",
    };
  }
  return { imports: scopeImport(requestScope), expr: `${requestScope.import}()` };
}

/** The import + `__active()` resolver (throws if the route wasn't preloaded). */
export function renderActiveResolver(requestScope: RequestScope): string {
  const { imports, expr } = activeSource(requestScope);
  return `${imports}

function __active() {
  const a = ${expr};
  if (!a) throw new Error(${JSON.stringify(PRELOAD_ERROR)});
  return a;
}`;
}

/**
 * Like {@link renderActiveResolver} but returns `null` instead of throwing — for
 * the RSC hydrator, which must be a no-op on routes that never preloaded a graph.
 */
export function renderActiveResolverNullable(requestScope: RequestScope): string {
  const { imports, expr } = activeSource(requestScope);
  return `${imports}

function __activeOrNull() {
  return (${expr}) || null;
}`;
}
