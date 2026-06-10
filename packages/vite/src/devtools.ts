import { renderReadMapTree, summarizeOperation, type OperationArtifact } from "@gleanql/core";

/**
 * The dev-only `/__glean` overlay: everything the build compiled, on one page —
 * each operation's document, persisted hash, size stats, per-component read-map
 * tree, and any compiler diagnostics from the last generate. Pure
 * string-rendering (unit-testable); the plugin's `configureServer` serves it.
 */

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const CSS = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px; font: 15px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif; color: #1c2430; background: #f7f8fa; }
  h1 { font-size: 26px; letter-spacing: -0.02em; margin: 0 0 4px; }
  .sub { color: #5b6675; margin: 0 0 28px; }
  .op { background: #fff; border: 1px solid #e3e7ee; border-radius: 10px; margin: 0 0 20px; max-width: 980px; overflow: hidden; }
  .op-head { display: flex; align-items: baseline; gap: 10px; padding: 12px 18px; border-bottom: 1px solid #eef1f5; }
  .op-head h2 { font-size: 17px; margin: 0; }
  .kind { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; padding: 2px 8px; border-radius: 99px; background: #eef2ff; color: #4338ca; }
  .kind.mutation { background: #fef3e2; color: #b45309; }
  .kind.subscription { background: #ecfdf5; color: #047857; }
  .hash { font: 12px ui-monospace, monospace; color: #8893a4; margin-left: auto; }
  .stats { padding: 8px 18px; color: #5b6675; font-size: 13px; border-bottom: 1px solid #eef1f5; }
  .label { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #8893a4; padding: 12px 18px 0; }
  pre { margin: 8px 18px 16px; padding: 14px 16px; background: #10141b; color: #dbe2ec; border-radius: 8px; overflow-x: auto; font: 13px/1.55 ui-monospace, "SF Mono", monospace; }
  .warn { margin: 8px 18px 16px; padding: 10px 14px; border-left: 4px solid #d9a000; background: #fff7e6; border-radius: 6px; white-space: pre-wrap; font-size: 13.5px; }
  .diags { max-width: 980px; margin: 0 0 24px; padding: 12px 18px; border-left: 4px solid #d9534f; background: #fdf1f0; border-radius: 6px; }
  .diags pre { background: transparent; color: #7a2f2b; margin: 0; padding: 0; }
`;

export function renderDevtoolsHtml(
  operations: Record<string, OperationArtifact>,
  diagnostics: readonly string[],
): string {
  const ops = Object.values(operations)
    .map((op) => {
      const summary = summarizeOperation(op.name, op.stats, op.readMap);
      const warnings = summary.warnings.map((w) => `<div class="warn">${esc(w)}</div>`).join("");
      const readMap =
        Object.keys(op.readMap).length > 0
          ? `<div class="label">Read map (per component)</div><pre>${esc(renderReadMapTree(op.name, op.readMap))}</pre>`
          : "";
      return `<section class="op">
  <div class="op-head"><h2>${esc(op.name)}</h2><span class="kind ${op.kind}">${op.kind}</span><span class="hash" title="persisted-operation id (sha-256)">${esc(op.hash.slice(0, 16))}…</span></div>
  <div class="stats">${op.stats.fieldCount} fields · ${op.stats.rootCount} root${op.stats.rootCount === 1 ? "" : "s"} · ${op.stats.connectionCount} connection${op.stats.connectionCount === 1 ? "" : "s"}${op.source ? ` · <span title="route module">${esc(op.source)}</span>` : ""}</div>
  ${warnings}
  <div class="label">Document</div><pre>${esc(op.document.trim())}</pre>
  ${readMap}
</section>`;
    })
    .join("\n");

  const diags =
    diagnostics.length > 0
      ? `<div class="diags"><strong>${diagnostics.length} compiler diagnostic(s)</strong><pre>${esc(diagnostics.join("\n\n"))}</pre></div>`
      : "";

  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>glean devtools</title><style>${CSS}</style></head>
<body>
<h1>glean devtools</h1>
<p class="sub">${Object.keys(operations).length} compiled operation(s). Operations recompile live as you edit — refresh this page to see the latest.</p>
${diags}
${ops}
</body>
</html>
`;
}
