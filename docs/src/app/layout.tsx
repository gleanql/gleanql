/**
 * The shared docs chrome: brand + sidebar nav on the left, the page's article on
 * the right. `active` is the page's path (e.g. "usage.html") — the matching nav
 * link gets the `active` class, exactly like the static site did.
 */

export interface NavPage {
  readonly href: string;
  readonly label: string;
}

export const NAV_GROUPS: ReadonlyArray<{ readonly group: string; readonly pages: readonly NavPage[] }> = [
  {
    group: "Guide",
    pages: [
      { href: "index.html", label: "Overview" },
      { href: "get-started.html", label: "Get started" },
      { href: "usage.html", label: "Using Glean" },
      { href: "comparison.html", label: "vs Relay & gqty" },
      { href: "architecture.html", label: "Architecture & pipeline" },
    ],
  },
  {
    group: "Internals",
    pages: [
      { href: "core.html", label: "@gleanql/core" },
      { href: "compiler.html", label: "@gleanql/compiler" },
      { href: "runtime.html", label: "@gleanql/client" },
      { href: "vite.html", label: "@gleanql/vite" },
      { href: "rwsdk.html", label: "RedwoodSDK integration" },
      { href: "react-router.html", label: "React Router integration" },
      { href: "codegen.html", label: "@gleanql/codegen" },
    ],
  },
  {
    group: "Reference",
    pages: [
      { href: "golden-cases.html", label: "Golden cases" },
      { href: "api.html", label: "API reference" },
      { href: "decisions.html", label: "Design decisions" },
    ],
  },
];

export function DocsLayout({ active, children }: { active: string; children: React.ReactNode }) {
  return (
    <>
      <aside className="sidebar">
        <div className="brand">
          glean<span>·</span>graphql
        </div>
        <div className="brand-sub">TypeScript-native GraphQL — without the queries</div>
        <nav>
          {NAV_GROUPS.map(({ group, pages }) => (
            <div key={group}>
              <div className="group">{group}</div>
              {pages.map(({ href, label }) => (
                <a key={href} href={`/${href}`} className={href === active ? "active" : undefined}>
                  {label}
                </a>
              ))}
            </div>
          ))}
        </nav>
      </aside>
      <main>
        <article>{children}</article>
      </main>
    </>
  );
}
