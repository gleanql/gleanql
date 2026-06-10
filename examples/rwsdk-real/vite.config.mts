import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { glean } from "@gleanql/vite";

export default defineConfig({
  plugins: [
    // Generates the schema-specific runtime (graph accessor, types, operations)
    // into the @gleanql/client package from schema.graphql. Routes are discovered
    // automatically (any file that opens a `graph` root) — just point it at the
    // schema. The only wiring the app needs.
    // `persisted` = client-side refetch/mutations send the operation's sha-256
    // hash, never the document; the worker's /graphql route enforces the
    // build-produced allowlist via `createPersistedResolver`.
    // `operations` registers hand-built buildQuery IR (src/report-operations.ts)
    // into that same allowlist; `gcKeepPages` collects cache records untouched
    // for two navigations (retained/on-screen data is never collected).
    glean({
      schema: "../storefront-fixture/schema.graphql",
      persisted: true,
      operations: "./src/report-operations.ts",
      gcKeepPages: 2,
      masking: true,
    }),
    cloudflare({
      viteEnvironment: { name: "worker" },
    }),
    redwood(),
  ],
});
