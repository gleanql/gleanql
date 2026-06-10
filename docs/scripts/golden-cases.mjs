// Generate docs/content/golden-cases.md FROM THE FIXTURES — the page can never
// go stale again. Each fixture renders as: heading, the input file(s), the
// expected operation/variables/read-map/diagnostics. Runs before dev/build.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, "..", "..", "packages", "compiler", "test", "fixtures");

const titleOf = (name) =>
  name
    .replace(/^\d+-/, "")
    .split("-")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");

const fence = (lang, body) => "```" + lang + "\n" + body.trimEnd() + "\n```\n";

const sections = [];
const fixtures = fs
  .readdirSync(fixturesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

for (const name of fixtures) {
  const dir = path.join(fixturesDir, name);
  if (!fs.existsSync(path.join(dir, "input.tsx"))) continue;
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8") : undefined);

  let s = `## ${titleOf(name)}\n\n\`${name}\`\n\n`;
  s += `**Input — input.tsx**\n\n${fence("tsx", read("input.tsx"))}\n`;
  for (const extra of fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f) && f !== "input.tsx" && !f.startsWith("expected."))) {
    s += `**Input — ${extra}**\n\n${fence("tsx", read(extra))}\n`;
  }
  const graphql = read("expected.graphql");
  if (graphql) s += `**Generated GraphQL**\n\n${fence("graphql", graphql)}\n`;
  const vars = read("expected.variables.ts");
  if (vars) s += `**Variables factory**\n\n${fence("ts", vars)}\n`;
  const readmap = read("expected.readmap.json");
  if (readmap) s += `**Read map**\n\n${fence("json", JSON.stringify(JSON.parse(readmap), null, 2))}\n`;
  const diags = read("expected.diagnostics.json");
  if (diags) {
    const list = JSON.parse(diags);
    s += `**Diagnostics**\n\n${fence("text", list.map((d) => `[${d.code}]\n${d.message}`).join("\n\n"))}\n`;
  }
  sections.push(s.trimEnd());
}

const out = `---
title: Golden cases
group: Reference
order: 13
---

# Golden cases

The compiler's behavior catalog, generated directly from \`packages/compiler/test/fixtures/\` — every case below is a real golden fixture: \`input.tsx\` plus the expected operation, variables factory, read map and diagnostics, asserted byte-for-byte through BOTH type-checker engines and validated against the schema with graphql-js.

${sections.join("\n\n")}

---

${fixtures.length} fixtures. This page regenerates from the fixtures on every build.
`;

fs.writeFileSync(path.join(here, "..", "content", "golden-cases.md"), out);
console.log(`golden-cases: ${fixtures.length} fixtures → content/golden-cases.md`);
