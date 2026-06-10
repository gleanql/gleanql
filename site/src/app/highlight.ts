/**
 * Tiny server-side syntax highlighter for the docs' code blocks. Pages author
 * code as plain template literals; this tokenizes at render time into the
 * `.tok-*` classes styles.css colors. Regex-per-language, first-match-wins —
 * deliberately small (four languages, zero deps, runs fine on workerd).
 */

export type CodeLang = "tsx" | "ts" | "graphql" | "bash" | "json" | "text";

type Rule = readonly [RegExp, string | null];

const TS_RULES: readonly Rule[] = [
  [/^\/\/[^\n]*/, "tok-c"],
  [/^\/\*[\s\S]*?\*\//, "tok-c"],
  [/^`(?:\\.|[^`\\])*`/, "tok-s"],
  [/^"(?:\\.|[^"\\])*"/, "tok-s"],
  [/^'(?:\\.|[^'\\])*'/, "tok-s"],
  [
    /^\b(?:import|export|from|const|let|var|function|return|if|else|for|of|in|new|type|interface|extends|implements|async|await|class|default|throw|try|catch|finally|switch|case|break|continue|typeof|keyof|readonly|enum|satisfies|as|true|false|null|undefined|this|void|do|while|declare|namespace|never|unknown|any|string|number|boolean)\b/,
    "tok-k",
  ],
  [/^\b\d[\d_]*(?:\.\d+)?\b/, "tok-n"],
  [/^[A-Za-z_$][\w$]*(?=\s*\()/, "tok-f"],
  [/^[A-Z][\w$]*/, "tok-t"],
  [/^[A-Za-z_$][\w$]*/, null],
];

const GRAPHQL_RULES: readonly Rule[] = [
  [/^#[^\n]*/, "tok-c"],
  [/^"(?:\\.|[^"\\])*"/, "tok-s"],
  [
    /^\b(?:query|mutation|subscription|fragment|on|type|input|enum|interface|union|scalar|schema|directive|implements|extend)\b/,
    "tok-k",
  ],
  [/^\$[\w]+/, "tok-t"],
  [/^\b\d[\d_]*(?:\.\d+)?\b/, "tok-n"],
  [/^[A-Za-z_][\w]*(?=\s*\()/, "tok-f"],
  [/^[A-Z][\w]*!?/, "tok-t"],
  [/^[A-Za-z_][\w]*/, null],
];

const BASH_RULES: readonly Rule[] = [
  [/^#[^\n]*/, "tok-c"],
  [/^"(?:\\.|[^"\\])*"/, "tok-s"],
  [/^'(?:\\.|[^'\\])*'/, "tok-s"],
  [/^(?:pnpm|pnpx|npm|npx|node|git|curl|wrangler|cd|mkdir|rm|cp|cat|echo)\b/, "tok-f"],
  [/^--?[\w-]+/, "tok-t"],
  [/^[A-Za-z_][\w./@-]*/, null],
];

const JSON_RULES: readonly Rule[] = [
  [/^"(?:\\.|[^"\\])*"(?=\s*:)/, "tok-f"],
  [/^"(?:\\.|[^"\\])*"/, "tok-s"],
  [/^\b(?:true|false|null)\b/, "tok-k"],
  [/^-?\b\d[\d_]*(?:\.\d+)?\b/, "tok-n"],
];

const RULES: Record<CodeLang, readonly Rule[]> = {
  tsx: TS_RULES,
  ts: TS_RULES,
  graphql: GRAPHQL_RULES,
  bash: BASH_RULES,
  json: JSON_RULES,
  text: [],
};

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Highlight `source` into token-span HTML (pre-escaped, safe to inject). */
export function highlight(source: string, lang: CodeLang): string {
  const rules = RULES[lang] ?? [];
  let rest = source;
  let out = "";
  let plain = ""; // batch untokenized runs so output stays small
  const flush = (): void => {
    if (plain) {
      out += esc(plain);
      plain = "";
    }
  };
  outer: while (rest.length > 0) {
    for (const [re, cls] of rules) {
      const m = re.exec(rest);
      if (m && m[0].length > 0) {
        rest = rest.slice(m[0].length);
        if (cls) {
          flush();
          out += `<span class="${cls}">${esc(m[0])}</span>`;
        } else {
          plain += m[0];
        }
        continue outer;
      }
    }
    plain += rest[0];
    rest = rest.slice(1);
  }
  flush();
  return out;
}
