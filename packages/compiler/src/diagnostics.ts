/**
 * Compiler diagnostics. Unsupported patterns produce clear, actionable
 * messages (see the brief's "Compiler supported subset for v1"). Diagnostics
 * are part of the golden output (expected.diagnostics.json).
 */

export type DiagnosticCode =
  | "dynamic-field-access"
  | "unresolved-dynamic-component"
  | "graph-value-spread"
  | "recursive-component"
  | "unsupported-list-flow"
  | "unawaited-deferred-read"
  | "imported-helper";

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  /** 1-based line of the offending source, when known. */
  readonly line?: number;
}

export const messages = {
  dynamicFieldAccess(expr: string): string {
    return (
      `Cannot compile dynamic graph field access ${expr}.\n` +
      `Graph fields must be accessed with static property names.`
    );
  },
  unresolvedDynamicComponent(tag: string, props: ReadonlyArray<readonly [string, string]>): string {
    const propLines = props.map(([name, type]) => `  ${name}: ${type}`).join("\n");
    return (
      `Cannot statically resolve graph-backed JSX component <${tag} />.\n\n` +
      `The component receives graph-backed props:\n${propLines}\n\n` +
      `Use a static conditional, a graph.components(...) registry,\n` +
      `or provide explicit candidates.`
    );
  },
  graphValueSpread(name: string): string {
    return (
      `Cannot spread graph-backed value ${name}.\n` +
      `Graph values must be passed, read, or explicitly converted.`
    );
  },
  recursiveComponent(name: string): string {
    return (
      `Cannot statically expand recursive graph component <${name} />.\n` +
      `Provide an explicit recursion depth or wrap the recursive subtree in a lazy boundary.`
    );
  },
  unsupportedListFlow(expr: string): string {
    return (
      `Cannot statically analyze the list callback ${expr}.\n` +
      `Use an inline arrow/function, a reference to a named function, or a destructured\n` +
      `element parameter — the callback's element reads must be statically visible.`
    );
  },
  unawaitedDeferredRead(root: string): string {
    return (
      `Deferred graph root \`glean.${root}({ … })\` is read synchronously in an async component.\n` +
      `\`await\` it — e.g. \`const x = await glean.${root}({ … })\`. A synchronous (Suspense) read\n` +
      `thrown from inside an async component re-invokes it and loops until the CPU budget is\n` +
      `exhausted. The synchronous form is only for a non-async component.`
    );
  },
} as const;
