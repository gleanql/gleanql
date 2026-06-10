import { render, route } from "rwsdk/router";
import { defineApp } from "rwsdk/worker";

import { Document } from "@/app/document";
import { MarkdownPage } from "@/app/markdown";
import { PAGES } from "@/app/content";

export type AppContext = Record<string, never>;

// Filesystem-driven: every docs/content/*.md is a page (see content.ts). Each
// answers on its clean path (`/usage`), the legacy static-site path
// (`/usage.html`), and the markdown path (`/usage.md` — in-article links are
// written for GitHub browsing and resolve on the site too).
export default defineApp([
  render(Document, [
    route("/", () => <MarkdownPage slug="index" />),
    ...PAGES.flatMap((p) => [
      route(`/${p.slug}`, () => <MarkdownPage slug={p.slug} />),
      route(`/${p.slug}.html`, () => <MarkdownPage slug={p.slug} />),
      route(`/${p.slug}.md`, () => <MarkdownPage slug={p.slug} />),
    ]),
  ]),
]);
