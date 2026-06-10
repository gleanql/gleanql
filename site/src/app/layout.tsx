import { MenuButton, Search, ThemeToggle, Toc } from "./islands";
import { NAV_GROUPS, PAGES } from "./content";

/**
 * The docs chrome: sticky top bar (brand · ⌘K search · GitHub · theme), grouped
 * sidebar with the harvest-gold active rail, the article column (kicker derived
 * from the page's group), prev/next footer cards, and the scroll-spy "On this
 * page" rail. Navigation derives entirely from the markdown files' frontmatter
 * (see content.ts) — there is nothing to register here.
 */
export function DocsLayout({ active, children }: { active: string; children: React.ReactNode }) {
  const index = PAGES.findIndex((p) => p.slug === active);
  const current = PAGES[index];
  const prev = index > 0 ? PAGES[index - 1] : undefined;
  const next = index >= 0 && index < PAGES.length - 1 ? PAGES[index + 1] : undefined;

  return (
    <>
      <header className="topbar">
        <MenuButton />
        <a className="brand" href="/">
          <span className="mark">✳</span>
          gleanql
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
                {pages.map(({ slug, title }) => (
                  <a key={slug} href={`/${slug}`} className={slug === active ? "active" : undefined}>
                    {title}
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
                  <a href={`/${prev.slug}`}>
                    <span className="dir">← Previous</span>
                    <span className="title">{prev.title}</span>
                  </a>
                ) : (
                  <span />
                )}
                {next ? (
                  <a className="next" href={`/${next.slug}`}>
                    <span className="dir">Next →</span>
                    <span className="title">{next.title}</span>
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
