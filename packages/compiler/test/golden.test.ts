import { describe, it } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeWithTs } from "../src/index.js";
import { mockSchema } from "./support/mock-schema.js";
import { listGoldenFixtures } from "./support/golden-fixtures.js";
import { assertFixture } from "./support/golden-assert.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const supportDir = path.join(here, "support");
const fixturesDir = path.join(here, "fixtures");

const fixtures = listGoldenFixtures(fixturesDir);

/**
 * Golden fixtures, driven by the `typescript` engine. Fixtures may be split
 * across files (entry `input.tsx` + extra `.ts(x)`); the tsgo suite in
 * `tsgo.test.ts` runs the same set through the alternative engine.
 */
describe("golden fixtures (typescript engine)", () => {
  for (const f of fixtures) {
    it(f.name, () => {
      const result = analyzeWithTs({
        fileName: f.fileName,
        supportDir,
        schema: mockSchema,
        extraFiles: f.extraFiles,
        paths: f.paths,
        baseUrl: f.baseUrl,
      });
      assertFixture(result, f.dir);
    });
  }
});
