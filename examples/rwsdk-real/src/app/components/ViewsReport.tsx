"use client";
import { useEffect, useState } from "react";
import { runOperation, onEvent } from "@gleanql/client/client";

type ReportRow = { readonly id: string; readonly title: string; readonly views: number };

/**
 * A REGISTERED operation in action: `CollectionReport` was hand-built with
 * `buildQuery` in `src/report-operations.ts` (no route reads it), compiled into
 * the persisted allowlist at build time, and executed here BY NAME — in
 * persisted mode only its sha-256 hash rides the wire. The result seeds the
 * normalized cache like any other operation.
 */
export function ViewsReport({ handle }: { handle: string }) {
  const [rows, setRows] = useState<readonly ReportRow[] | undefined>();
  const [busy, setBusy] = useState(false);

  // Runtime incidents (refresh/mutation/subscription failures, persisted
  // retries, gc) flow through ONE channel — in a real app this is your Sentry
  // hook. Registered client-side (the generated glue can't bake a function).
  useEffect(() => onEvent((event) => console.info("[glean event]", event)), []);

  const run = async () => {
    setBusy(true);
    try {
      // Fully typed by the generated GleanOperations interface — variables AND
      // result shape are checked against the registered operation, no casts.
      const result = await runOperation("CollectionReport", { handle });
      setRows(result.data?.collection?.products.nodes ?? []);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section style={{ marginTop: "2rem", borderTop: "1px solid #ddd", paddingTop: "1rem" }}>
      <button onClick={() => void run()} disabled={busy}>
        {busy ? "Running report…" : "Run views report (registered operation)"}
      </button>
      {rows && (
        <table style={{ marginTop: "1rem", borderCollapse: "collapse" }}>
          <thead>
            <tr><th align="left">Product</th><th align="right">Views</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td style={{ paddingRight: "2rem" }}>{r.title}</td>
                <td align="right">{r.views}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
