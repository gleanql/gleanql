import { highlight, type CodeLang } from "./highlight";

/**
 * The docs code block. Author code as a plain template literal — no escaped
 * braces, no hand-written spans — and it renders server-side with the
 * harvest syntax palette, a language/filename bar, and a copy button
 * (wired by the delegation script in the Document).
 *
 *   <Code lang="tsx" title="vite.config.ts">{`
 *     import { glean } from "@gleanql/vite";
 *   `}</Code>
 */
export function Code({
  lang = "tsx",
  title,
  children,
}: {
  lang?: CodeLang;
  title?: string;
  children: string;
}) {
  // Trim a leading newline + common indentation so literals can be written
  // indented in JSX without the indentation shipping.
  const text = dedent(children);
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span className="lang">{lang}</span>
        {title ? <span className="title">{title}</span> : null}
        <button className="code-copy" type="button" aria-label="Copy code">
          copy
        </button>
      </div>
      <pre>
        <code dangerouslySetInnerHTML={{ __html: highlight(text, lang) }} />
      </pre>
    </div>
  );
}

function dedent(raw: string): string {
  const lines = raw.replace(/^\n/, "").trimEnd().split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length);
  const cut = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(cut)).join("\n");
}
