import { MenuButton, Search, ThemeToggle, Toc } from "./islands";

/**
 * The docs chrome: sticky top bar (brand · ⌘K search · GitHub · theme), grouped
 * sidebar with the harvest-gold active rail, the article column (kicker derived
 * from the active page's group), prev/next footer cards, and the scroll-spy
 * "On this page" rail. `active` is the page's path (e.g. "usage.html").
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

const FLAT = NAV_GROUPS.flatMap((g) => g.pages.map((p) => ({ ...p, group: g.group })));

export function DocsLayout({ active, children }: { active: string; children: React.ReactNode }) {
  const index = FLAT.findIndex((p) => p.href === active);
  const current = FLAT[index];
  const prev = index > 0 ? FLAT[index - 1] : undefined;
  const next = index >= 0 && index < FLAT.length - 1 ? FLAT[index + 1] : undefined;

  return (
    <>
      <header className="topbar">
        <MenuButton />
        <a className="brand" href="/">
          <span className="mark">✳</span>
          glean
          <span className="tag">docs</span>
        </a>
        <div className="topbar-spacer" />
        <Search />
        <a
          className="icon-btn"
          href="https://github.com/gleanql/gleanql"
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub"
          title="GitHub"
        >
          ↗
        </a>
        <ThemeToggle />
      </header>

      <div className="shell">
        <aside className="sidebar">
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
          <article>
            {current ? <div className="kicker">{current.group}</div> : null}
            {children}

            {(prev || next) && (
              <nav className="pagenav">
                {prev ? (
                  <a href={`/${prev.href}`}>
                    <span className="dir">← Previous</span>
                    <span className="title">{prev.label}</span>
                  </a>
                ) : (
                  <span />
                )}
                {next ? (
                  <a className="next" href={`/${next.href}`}>
                    <span className="dir">Next →</span>
                    <span className="title">{next.label}</span>
                  </a>
                ) : null}
              </nav>
            )}
          </article>
        </main>

        <aside className="toc">
          <Toc />
        </aside>
      </div>
    </>
  );
}
