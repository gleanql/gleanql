import { defineConfig } from "vite";
import { redwood } from "rwsdk/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// The docs are a plain RedwoodSDK app: every page is a React Server Component,
// styles ride /public, navigation uses RSC client nav. No Glean plugin here —
// the docs site must stay rock-solid independent of what it documents.
export default defineConfig({
  plugins: [
    cloudflare({
      viteEnvironment: { name: "worker" },
    }),
    redwood(),
  ],
});
