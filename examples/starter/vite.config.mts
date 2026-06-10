import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { glean } from "@gleanql/vite";

export default defineConfig({
  plugins: [
    // The only GleanQL wiring an app needs: point the plugin at the schema.
    // It generates the typed accessor, compiles the operations, and provisions
    // the runtime — all into node_modules, nothing committed.
    glean({ schema: "schema.graphql" }),
    cloudflare({ viteEnvironment: { name: "worker" } }),
    redwood(),
  ],
});
