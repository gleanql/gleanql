import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";
import type { GraphHydrationPayload } from "@gleanql/client";
import { hydrate } from "@gleanql/client/client";
import { scope } from "~/graph-scope";
import { preloadForRequest, activePayload } from "~/graph.server";

// All graph wiring lives here — the rest of the app is graph-unaware.
//
// `middleware` is a server-only export (React Router strips it and its
// `graph.server` import from the client bundle). Its `next()` wraps both the route
// loaders and the document render, so one `scope.run(...)` makes `graph.product(...)`
// resolve to this request's seeded runtime across the loader→render handoff.
export const middleware = [
  async ({ request }: { request: Request }, next: () => Promise<Response>) => {
    const active = await preloadForRequest(request);
    return active ? scope.run(active, () => next()) : next();
  },
];

// The root loader serializes this request's cache; React Router ships it to the
// client as loader data (initial HTML + every `.data` navigation).
export function loader() {
  return { graphPayload: activePayload() ?? null };
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Glean · React Router</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const { graphPayload } = useLoaderData() as { graphPayload: GraphHydrationPayload | null };
  // Hydrate during render (not in an effect) so child routes read warm on the very
  // first pass — no waterfall, no hydration mismatch. On the client this builds the
  // runtime on first load and merges later navigations' snapshots; on the server
  // it's a no-op (the request's runtime is already set by middleware).
  hydrate(graphPayload ?? undefined);
  return <Outlet />;
}
