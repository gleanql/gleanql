import type { ReadMap, OperationStats } from "./operation.js";

/**
 * Dev diagnostics. Renders the per-component read map as a tree and flags
 * large/expensive operations (field/root/connection counts + the largest
 * contributing component), per the brief's "Dev diagnostics and read maps".
 */
export function renderReadMapTree(operationName: string, readMap: ReadMap): string {
  const lines = [`${operationName} query`];
  for (const [component, fields] of Object.entries(readMap)) {
    lines.push(`  ${component}`);
    for (const field of fields) lines.push(`    ${field}`);
  }
  return lines.join("\n");
}

export interface OperationSummary {
  readonly stats: OperationStats;
  readonly largestContributor?: { readonly component: string; readonly reads: number };
  readonly warnings: readonly string[];
}

export function summarizeOperation(
  operationName: string,
  stats: OperationStats,
  readMap: ReadMap,
  options: { fieldThreshold?: number } = {},
): OperationSummary {
  const threshold = options.fieldThreshold ?? 100;
  const contributors = Object.entries(readMap)
    .map(([component, fields]) => ({ component, reads: fields.length }))
    .sort((a, b) => b.reads - a.reads);
  const largestContributor = contributors[0];

  const warnings: string[] = [];
  if (stats.fieldCount > threshold) {
    let msg = `${operationName} query includes ${stats.fieldCount} fields across ${stats.rootCount} roots.`;
    if (largestContributor) {
      msg += `\nLargest contributor:\n  ${largestContributor.component} → ${largestContributor.reads} reads`;
    }
    warnings.push(msg);
  }
  return { stats, largestContributor, warnings };
}
