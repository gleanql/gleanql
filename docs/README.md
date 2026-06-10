# Glean documentation

These markdown files **are** the docs — start at [index.md](index.md), or read
them rendered at [gleanql.com](https://gleanql.com).

Each page carries `title` / `group` / `order` frontmatter that drives the
site's navigation. Adding a page is adding a `.md` file here. Two pages are
generated (don't edit by hand): `golden-cases.md` regenerates from the
compiler's test fixtures on every build of the site in [`site/`](../site/),
which also rebuilds the search index.

Editing anything here redeploys gleanql.com automatically.
