import { bench, describe } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeWithTs } from "../src/index.js";
import { mockSchema } from "../test/support/mock-schema.js";
import { listGoldenFixtures } from "../test/support/golden-fixtures.js";

/**
 * Compile-time cost, measured on the real pipeline (program construction +
 * type-checking + analysis + merge + print). Two shapes:
 *
 * - one representative route, end to end — the per-route marginal cost an app
 *   pays in dev regeneration
 * - the full golden corpus (36 fixtures), sequentially — the worst-case "cold
 *   build" shape, since each fixture builds its own program
 *
 * Run with: pnpm bench
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const supportDir = path.join(here, "..", "test", "support");
const fixturesDir = path.join(here, "..", "test", "fixtures");

const fixtures = listGoldenFixtures(fixturesDir);
const representative = fixtures.find((f) => f.name.includes("islands")) ?? fixtures[0]!;

const analyze = (f: (typeof fixtures)[number]) =>
  analyzeWithTs({
    fileName: f.fileName,
    supportDir,
    schema: mockSchema,
    extraFiles: f.extraFiles,
    paths: f.paths,
    baseUrl: f.baseUrl,
  });

describe("compiler", () => {
  bench(`one route, end to end (${representative.name})`, () => {
    analyze(representative);
  });

  bench(`golden corpus, ${fixtures.length} routes (separate programs)`, () => {
    for (const f of fixtures) analyze(f);
  });
});
