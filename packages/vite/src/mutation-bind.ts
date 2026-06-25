import ts from "typescript";
import { findSelectorHookSites, typescriptFacade, selectorHooks } from "@gleanql/compiler";

/**
 * Bind selector hooks (`useMutation` / `useSubscription`) to their compiled
 * operation (all frameworks).
 *
 * The selector never runs at runtime — Glean compiles it into a named operation at
 * build time. The runtime hook can't re-derive which operation a call site is, so
 * here we inject the operation name as a trailing argument:
 * `useMutation(selector, opts)` → `useMutation(selector, opts, "Cmp_field")`. The
 * name is derived from the SAME syntactic rule the analyzer uses
 * ({@link findSelectorHookSites}), so the two always agree.
 *
 * Only calls of the bare hooks imported from `@gleanql/client/client` are touched;
 * already-bound calls (three args) are left alone. Returns the rewritten source,
 * or `null`.
 */
export function bindSelectorHookOps(code: string, fileName: string, serverMutate?: string): string | null {
  const hooks = selectorHooks(serverMutate);
  // Cheap pre-check: skip files that can't contain a selector-hook call. The
  // real gate is the selector SHAPE (`(accessor, vars) => accessor.field(...)`)
  // enforced by findSelectorHookSites — so we only need the callee name to
  // appear. (The server-mutate callee is imported from the framework, so we
  // can't gate on a `@gleanql/client/client` import the way the hooks could.)
  if (!Object.keys(hooks).some((n) => code.includes(n))) return null;

  const sf = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const sites = findSelectorHookSites(sf, typescriptFacade, hooks);
  if (sites.length === 0) return null;

  const edits: { pos: number; text: string }[] = [];
  for (const site of sites) {
    const argc = site.call.arguments.length;
    if (argc >= 3) continue; // already bound (opName present)
    // Insert right after the LAST argument (not before `)`), so a trailing comma in
    // the call doesn't produce a double comma. Pad a missing options arg.
    const text = argc === 1 ? `, undefined, ${JSON.stringify(site.opName)}` : `, ${JSON.stringify(site.opName)}`;
    edits.push({ pos: site.call.arguments[argc - 1]!.getEnd(), text });
  }
  if (edits.length === 0) return null;

  edits.sort((a, b) => b.pos - a.pos);
  let out = code;
  for (const e of edits) out = out.slice(0, e.pos) + e.text + out.slice(e.pos);
  return out;
}
