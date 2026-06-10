import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { buildSchema, printSchema } from "graphql";
import { storefrontSDL } from "../src/index.js";

// The fixture ships the schema twice: as `schema.graphql` (the file the @gleanql/vite
// plugin reads at build) and as `storefrontSDL` (the string the in-memory executor
// builds from). They must describe the same schema — this guards against drift.
describe("storefront fixture schema", () => {
  it("schema.graphql and storefrontSDL describe the same schema", () => {
    const file = readFileSync(new URL("../schema.graphql", import.meta.url), "utf8");
    expect(printSchema(buildSchema(file))).toBe(printSchema(buildSchema(storefrontSDL)));
  });
});
