import { describe, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mockSchema } from "./support/mock-schema.js";
import { listGoldenFixtures } from "./support/golden-fixtures.js";
import { assertFixture } from "./support/golden-assert.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const supportDir = path.join(here, "support");
const fixturesDir = path.join(here, "fixtures");

// The tsgo engine is an optional dependency; skip the suite if it's absent.
let analyzeWithTsgo: typeof import("../src/tsgo/index.js").analyzeWithTsgo | undefined;
try {
  await import("@typescript/native-preview/unstable/sync");
  ({ analyzeWithTsgo } = await import("../src/tsgo/index.js"));
} catch {
  analyzeWithTsgo = undefined;
}

const fixtures = listGoldenFixtures(fixturesDir);

/**
 * The EXPERIMENTAL tsgo engine must reproduce the `typescript` engine on the
 * exact same golden fixtures — single- and split-file alike. Proves the AST
 * facade + backend seam fully decouples the analyzer from the type engine.
 */
describe.skipIf(!analyzeWithTsgo)("golden fixtures (tsgo engine)", () => {
  for (const f of fixtures) {
    it(f.name, async () => {
      const result = await analyzeWithTsgo!({
        fileName: f.fileName,
        fileNames: [f.fileName, ...f.extraFiles],
        supportDir,
        schema: mockSchema,
        paths: f.paths,
        baseUrl: f.baseUrl,
      });
      assertFixture(result, f.dir);
    });
  }
});
