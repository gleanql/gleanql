/**
 * `@gleanql/client` — the runtime an app installs.
 *
 * Bundles everything the app/worker needs at runtime: the Suspense-aware cache,
 * graph proxies, request scope, mutations, the RedwoodSDK integration
 * (preload/seed, serialize/hydrate), and the fetch transport adapter. The build
 * plugin (`@gleanql/vite`) generates the schema-specific `graph` accessor +
 * `operations` into this package's `generated/` slot; the app then imports
 * everything from `@gleanql/client`.
 */
// Runtime core
export * from "./adapter.js";
export * from "./cache.js";
export * from "./normalize.js";
export * from "./runtime.js";
export * from "./route.js";
export * from "./cache-resolve.js";
export * from "./proxy.js";
export * from "./scope.js";
export * from "./mutation.js";
export * from "./mutator.js";
// RedwoodSDK integration
export * from "./context.js";
export * from "./integration.js";
export * from "./serialize.js";
// Transport adapter helpers
export * from "./adapter-shared.js";
export * from "./adapter-ws.js";
// Persisted-operation allowlist (server side)
export * from "./persisted.js";
