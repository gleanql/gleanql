import { defineConfig } from "vitest/config";
import { glean } from "@gleanql/vite";

// The SAME glean plugin (and options) the app builds with — it provisions the
// generated @gleanql/client glue and binds the useMutation/useSubscription call
// sites in any island a test imports, exactly as the real build does. That's
// what makes the testing story full-fidelity: the harness seeds the production
// runtime, and the plugin compiles the production operations.
export default defineConfig({
  plugins: [
    glean({
      schema: "../storefront-fixture/schema.graphql",
      persisted: true,
      operations: "./src/report-operations.ts",
      gcKeepPages: 2,
      masking: true,
    }),
  ],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.tsx"],
  },
});
