import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import { glean } from "@gleanql/vite";
import { defineConfig } from "vite";

const appDir = path.resolve(import.meta.dirname, "app");

export default defineConfig({
  // `~/…` → app/… so the generated `@gleanql/client` glue (which imports the app's
  // universal scope module via `requestScope`) resolves from node_modules too.
  resolve: { alias: [{ find: /^~\//, replacement: appDir + "/" }] },
  // The generated glue lives in node_modules but imports the app's `~/graph-scope`;
  // bundle @gleanql/client through Vite (don't externalize) so that alias is applied.
  ssr: { noExternal: ["@gleanql/client"] },
  // …and keep it OUT of the dep optimizer: esbuild's prebundle scan doesn't apply
  // the `~/` alias, so optimizing it 503s the module in the browser and the page
  // silently never hydrates.
  optimizeDeps: {
    exclude: ["@gleanql/client"],
    // @gleanql/client is excluded, so its deps get discovered during the first
    // load — pre-bundle them so that load doesn't 503 mid-optimization.
    include: ["react", "react/jsx-dev-runtime", "react-dom/client", "react-router", "@gleanql/core"],
  },
  plugins: [
    // Provisions @gleanql/client + codegens the schema/operations/glue into
    // node_modules. The react-router preset emits isomorphic (non-RSC) client glue
    // that shares the app's scope — no RSC server component, no route transform.
    glean({ schema: "../storefront-fixture/schema.graphql", framework: "react-router", endpoint: "/graphql" }),
    reactRouter(),
  ],
});
