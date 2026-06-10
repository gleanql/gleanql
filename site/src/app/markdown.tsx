import { Marked, type Tokens } from "marked";
import { highlight, type CodeLang } from "./highlight";
import { DocsLayout } from "./layout";
import { pageBySlug } from "./content";

/**
 * The markdown reader. Docs are authored as plain `.md` files in
 * `docs/content/` — fully readable on GitHub — and this renders them into the
 * site's design system at request time:
 *
 *  - fenced code → the codeblock chrome (language bar, copy button, harvest
 *    syntax palette via the shared highlighter)
 *  - headings → slugged ids (deep links + the scroll-spy rail)
 *  - GitHub alerts (`> [!NOTE]` / `> [!WARNING]` / `> [!TIP]`) → callouts
 *  - `*.md` links (correct when browsing on GitHub) → site routes
 *  - inline HTML passes through, so the few bespoke bits (cards, flow
 *    diagrams) live inline in the markdown and render in both places
 */

export const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\w]+/g, "-")
    .replace(/^-+|-+$/g, "");

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const ALERT_CLASS: Record<string, string> = { NOTE: "note", TIP: "ok", WARNING: "warn", CAUTION: "warn", IMPORTANT: "note" };

const md = new Marked({
  renderer: {
    code({ text, lang }: Tokens.Code): string {
      const language = (lang?.trim() || "text") as CodeLang;
      if (language === ("flow" as string)) {
        return `<div class="flow">${esc(text)}</div>\n`;
      }
      return (
        `<div class="codeblock"><div class="codeblock-bar"><span class="lang">${esc(language)}</span>` +
        `<button class="code-copy" type="button" aria-label="Copy code">copy</button></div>` +
        `<pre><code>${highlight(text, language)}</code></pre></div>\n`
      );
    },
    heading({ tokens, depth }: Tokens.Heading): string {
      const inner = this.parser!.parseInline(tokens);
      const plain = inner.replace(/<[^>]+>/g, "");
      return `<h${depth} id="${slugify(plain)}">${inner}</h${depth}>\n`;
    },
    blockquote({ tokens }: Tokens.Blockquote): string {
      const body = this.parser!.parse(tokens);
      const m = /^<p>\[!(NOTE|TIP|WARNING|CAUTION|IMPORTANT)\]\s*(?:<br\s*\/?>)?\s*/.exec(body);
      if (m) {
        const cls = ALERT_CLASS[m[1]!] ?? "note";
        return `<div class="${cls}"><p>${body.slice(m[0].length)}</div>\n`;
      }
      return `<blockquote>${body}</blockquote>\n`;
    },
    link({ href, tokens }: Tokens.Link): string {
      const inner = this.parser!.parseInline(tokens);
      // `usage.md` / `usage.md#x` reads right on GitHub; the site serves /usage.
      const site = href.replace(/^(?:\.\/)?([\w-]+)\.md(#.*)?$/, "/$1$2");
      const external = /^https?:/.test(site);
      return `<a href="${site}"${external ? ` target="_blank" rel="noreferrer"` : ""}>${inner}</a>`;
    },
  },
  breaks: false,
  gfm: true,
});

export function renderMarkdown(source: string): string {
  return md.parse(source, { async: false });
}

/** A docs page rendered from its markdown file — metadata from frontmatter. */
export function MarkdownPage({ slug }: { slug: string }) {
  const page = pageBySlug(slug);
  if (!page) return <DocsLayout active={slug}>Not found.</DocsLayout>;
  return (
    <DocsLayout active={page.slug}>
      <title>{`${page.title} · gleanql`}</title>
      <div dangerouslySetInnerHTML={{ __html: renderMarkdown(page.body) }} />
    </DocsLayout>
  );
}
