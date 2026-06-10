import fs from "node:fs";
import path from "node:path";

/**
 * A golden fixture is a directory with an `input.tsx` entry. It may be
 * *split across files*: any other `.ts(x)` in the directory (recursively, except
 * `expected.*`) joins the program, and an optional `options.json` supplies
 * `{ paths }` for tsconfig-style import aliases (resolved relative to the dir).
 * Expectations live in `expected.{graphql,variables.ts,readmap.json,diagnostics.json}`.
 */
export interface GoldenFixture {
  readonly name: string;
  readonly dir: string;
  readonly fileName: string;
  readonly extraFiles: readonly string[];
  readonly paths?: Record<string, string[]>;
  readonly baseUrl?: string;
}

export function listGoldenFixtures(fixturesDir: string): GoldenFixture[] {
  return fs
    .readdirSync(fixturesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort()
    .map((name) => loadFixture(path.join(fixturesDir, name), name))
    .filter((f): f is GoldenFixture => f !== undefined);
}

function loadFixture(dir: string, name: string): GoldenFixture | undefined {
  const fileName = path.join(dir, "input.tsx");
  if (!fs.existsSync(fileName)) return undefined;

  const extraFiles: string[] = [];
  const walk = (d: string): void => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.startsWith("expected.") && p !== fileName) {
        extraFiles.push(p);
      }
    }
  };
  walk(dir);

  let paths: Record<string, string[]> | undefined;
  let baseUrl: string | undefined;
  const optionsPath = path.join(dir, "options.json");
  if (fs.existsSync(optionsPath)) {
    const opts = JSON.parse(fs.readFileSync(optionsPath, "utf8")) as { paths?: Record<string, string[]> };
    baseUrl = dir;
    if (opts.paths) {
      paths = {};
      for (const [key, values] of Object.entries(opts.paths)) paths[key] = values.map((v) => path.resolve(dir, v));
    }
  }

  return { name, dir, fileName, extraFiles, paths, baseUrl };
}

/** Read an `expected.*` file from a fixture dir, or undefined if absent. */
export function readExpected(dir: string, file: string): string | undefined {
  const p = path.join(dir, file);
  // CRLF-normalize: goldens are asserted byte-for-byte against LF printer
  // output, and a CRLF checkout (windows without our .gitattributes) must not
  // turn every assertion into an invisible-\r mismatch.
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n") : undefined;
}
