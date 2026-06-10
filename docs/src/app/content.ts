/**
 * Filesystem-driven content: every `docs/content/*.md` IS a page. Vite's glob
 * import inlines them at build time (workerd has no runtime fs), frontmatter
 * carries the nav metadata, and the sidebar/routes/search derive from it —
 * adding a page is dropping a markdown file, nothing else.
 *
 *   ---
 *   title: Get started
 *   group: Guide
 *   order: 2
 *   ---
 */

export interface DocPage {
  readonly slug: string;
  readonly title: string;
  readonly group: string;
  readonly order: number;
  /** Markdown body (frontmatter stripped). */
  readonly body: string;
}

const GROUP_ORDER = ["Guide", "Internals", "Reference"];

const raw = import.meta.glob("../../content/*.md", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

function parse(path: string, source: string): DocPage {
  const slug = /([\w-]+)\.md$/.exec(path)![1]!;
  const m = /^---\n([\s\S]*?)\n---\n/.exec(source);
  const meta: Record<string, string> = {};
  if (m) {
    for (const line of m[1]!.split("\n")) {
      const kv = /^([\w-]+):\s*(.*)$/.exec(line.trim());
      if (kv) meta[kv[1]!] = kv[2]!.replace(/^["']|["']$/g, "");
    }
  }
  return {
    slug,
    title: meta.title ?? slug,
    group: meta.group ?? "Guide",
    order: Number(meta.order ?? 999),
    body: m ? source.slice(m[0].length) : source,
  };
}

export const PAGES: readonly DocPage[] = Object.entries(raw)
  .map(([path, source]) => parse(path, source))
  .sort((a, b) => a.order - b.order);

export const pageBySlug = (slug: string): DocPage | undefined => PAGES.find((p) => p.slug === slug);

/** Sidebar groups in canonical order; unknown groups append (no page is unreachable). */
export const NAV_GROUPS: ReadonlyArray<{ readonly group: string; readonly pages: readonly DocPage[] }> = [
  ...GROUP_ORDER,
  ...[...new Set(PAGES.map((p) => p.group))].filter((g) => !GROUP_ORDER.includes(g)),
].flatMap((group) => {
  const pages = PAGES.filter((p) => p.group === group);
  return pages.length > 0 ? [{ group, pages }] : [];
});
