import { GraphScope } from "@gleanql/client";

/**
 * The app's request scope — UNIVERSAL (loads in both the server and client
 * bundles). It must NOT import `node:async_hooks`: a plain `new GraphScope()` uses
 * a singleton on the client (installed at hydration by the generated client glue),
 * and `graph.server.ts` attaches an `AsyncLocalStorage` on the server to isolate
 * concurrent requests. The generated `graph` accessor resolves through `activeGraph`,
 * and the generated `@gleanql/client/client` glue installs/reads the runtime on `scope`.
 */
export const scope = new GraphScope();

/** Resolver the generated `graph` accessor calls (`requestScope.import`). */
export const activeGraph = () => scope.current();
