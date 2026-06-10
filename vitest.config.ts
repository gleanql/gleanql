import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const graphDir = fileURLToPath(new URL("./examples/storefront/graph", import.meta.url));

export default defineConfig({
  resolve: {
    // The `~/graph` import the runnable example uses at runtime (the compiler
    // resolves it separately via the TS Program's paths).
    alias: [
      { find: "~/graph/schema", replacement: `${graphDir}/schema.ts` },
      { find: "~/graph", replacement: `${graphDir}/graph.ts` },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "examples/*/**/*.test.ts"],
    globals: false,
  },
});
