// One-time: stamp nav frontmatter onto the converted markdown pages.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const content = path.join(here, "..", "content");

const META = {
  index: ["Overview", "Guide", 1],
  "get-started": ["Get started", "Guide", 2],
  usage: ["Using Glean", "Guide", 3],
  comparison: ["vs Relay & gqty", "Guide", 4],
  architecture: ["Architecture & pipeline", "Guide", 5],
  core: ["@gleanql/core", "Internals", 6],
  compiler: ["@gleanql/compiler", "Internals", 7],
  runtime: ["@gleanql/client", "Internals", 8],
  vite: ["@gleanql/vite", "Internals", 9],
  rwsdk: ["RedwoodSDK integration", "Internals", 10],
  "react-router": ["React Router integration", "Internals", 11],
  codegen: ["@gleanql/codegen", "Internals", 12],
  "golden-cases": ["Golden cases", "Reference", 13],
  api: ["API reference", "Reference", 14],
  decisions: ["Design decisions", "Reference", 15],
};

for (const [slug, [title, group, order]] of Object.entries(META)) {
  const file = path.join(content, `${slug}.md`);
  if (!fs.existsSync(file)) {
    console.log(`missing: ${slug}.md`);
    continue;
  }
  let src = fs.readFileSync(file, "utf8");
  if (src.startsWith("---\n")) {
    console.log(`has frontmatter: ${slug}.md`);
    continue;
  }
  src = `---\ntitle: ${title}\ngroup: ${group}\norder: ${order}\n---\n\n${src}`;
  fs.writeFileSync(file, src);
  console.log(`stamped: ${slug}.md`);
}
