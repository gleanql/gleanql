// Standalone-consumption e2e: prove the published packages work OUTSIDE the
// monorepo. Packs every @gleanql/* tarball exactly as `pnpm publish` would
// (publishConfig applied, workspace:* rewritten), installs them into a fresh
// temp app via file: overrides, and runs the @gleanql/vite generate pipeline
// there — provisioning, codegen, compile, emit, persisted manifest — twice
// (the second run exercises the re-run path where node_modules already holds
// the provisioned tree, not the pristine package).
//
// Usage: node scripts/pack-e2e.mjs   (requires `pnpm build` to have run)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "glean-pack-e2e-"));
const tarballDir = path.join(tmp, "tarballs");
const app = path.join(tmp, "app");
fs.mkdirSync(tarballDir);
fs.mkdirSync(path.join(app, "src"), { recursive: true });

const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: "pipe", encoding: "utf8" });
const fail = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};
const ok = (msg) => console.log(`✓ ${msg}`);

// 1. Pack every publishable package (publishConfig + workspace:* rewriting applied).
const PKGS = ["core", "compiler", "codegen", "client", "vite"];
const tarballs = {};
for (const pkg of PKGS) {
  const dir = path.join(repo, "packages", pkg);
  if (pkg !== "core" && pkg !== "codegen" && !fs.existsSync(path.join(dir, "dist"))) {
    fail(`packages/${pkg}/dist missing — run \`pnpm build\` first`);
  }
  const out = run("pnpm", ["pack", "--pack-destination", tarballDir], dir).trim().split("\n").pop();
  tarballs[`@gleanql/${pkg}`] = `file:${path.join(tarballDir, path.basename(out))}`;
}
ok(`packed ${PKGS.length} tarballs`);

// 2. A minimal standalone app: NOT inside any glean workspace; installs the
// tarballs like a real consumer (overrides force the inter-package deps to the
// local tarballs instead of the npm registry).
fs.writeFileSync(
  path.join(app, "package.json"),
  JSON.stringify(
    {
      name: "glean-pack-e2e-app",
      private: true,
      type: "module",
      dependencies: {
        "@gleanql/client": tarballs["@gleanql/client"],
        "@gleanql/vite": tarballs["@gleanql/vite"],
      },
      pnpm: { overrides: tarballs },
    },
    null,
    2,
  ),
);
fs.writeFileSync(
  path.join(app, "schema.graphql"),
  `type Query {\n  product(handle: String!): Product\n}\ntype Product {\n  id: ID!\n  handle: String!\n  title: String!\n  views: Int!\n}\n`,
);
fs.writeFileSync(
  path.join(app, "src", "ProductPage.tsx"),
  `import { glean } from "@gleanql/client";

export function ProductPage({ params }: { params: { handle: string } }) {
  const product = glean.product({ handle: params.handle });
  return (
    <main>
      <h1>{product.title}</h1>
      <p>{product.views} views</p>
    </main>
  );
}
`,
);

run("pnpm", ["install", "--no-frozen-lockfile"], app);
ok("installed tarballs into a standalone app");

// 3. Run the generate pipeline — what `glean()` does on every dev/build start.
const generateScript = `
import { generate } from "@gleanql/vite";
const result = await generate(process.cwd(), { schema: "./schema.graphql" });
if (!result.operations.ProductPage) {
  console.error("ProductPage operation missing:", Object.keys(result.operations));
  process.exit(1);
}
`;
fs.writeFileSync(path.join(app, "generate.mjs"), generateScript);
run("node", ["generate.mjs"], app);
ok("generate ran from installed packages (pristine install)");

// 4. Assert the provisioned + generated tree.
const gen = path.join(app, "node_modules", "@gleanql", "client");
const checks = [
  ["generated/operations.js", "query ProductPage"],
  ["generated/persisted.json", "query ProductPage"],
  ["generated/client.js", "createGraphClient"],
  ["src/glue-client.js", "createGraphClient"],
  ["src/glue-client.d.ts", "GraphClientEvent"],
  ["src/cache.d.ts", "GraphCache"],
  ["src/index.d.ts", "./cache.js"],
  ["index.d.ts", "product"],
];
for (const [file, needle] of checks) {
  const p = path.join(gen, file);
  if (!fs.existsSync(p)) fail(`missing ${file}`);
  if (!fs.readFileSync(p, "utf8").includes(needle)) fail(`${file} lacks "${needle}"`);
}
if (!fs.existsSync(path.join(app, "node_modules", "@gleanql", "core", "src", "index.d.ts"))) {
  fail("provisioned @gleanql/core missing declarations");
}
ok("provisioned runtime + generated artifacts verified");

// 5. Re-run: node_modules now holds the provisioned tree, not the pristine
// package — the stash must carry the sources.
run("node", ["generate.mjs"], app);
ok("generate re-ran against the provisioned tree (stash path)");

fs.rmSync(tmp, { recursive: true, force: true });
console.log("standalone consumption e2e PASSED");
