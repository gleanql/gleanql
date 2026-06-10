import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { glean } from "@gleanql/vite";

export default defineConfig({
  plugins: [
    // Generate the schema-specific runtime (graph accessor, branded types, compiled
    // operations) into @gleanql/client from this app's schema. Routes + selector-hook
    // islands are discovered automatically — the only graph wiring the app needs.
    glean({ schema: "schema.graphql" }),
    cloudflare({
      viteEnvironment: { name: "worker" },
    }),
    redwood(),
  ],
});
