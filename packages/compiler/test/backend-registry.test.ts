import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  analyze,
  analyzeWithTs,
  createBackend,
  listBackends,
  registerBackend,
  TsBackend,
  type GraphCompilerBackend,
} from "../src/index.js";
import { mockSchema } from "./support/mock-schema.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const supportDir = path.join(here, "support");
const fixture = path.join(here, "fixtures", "21-split-file-components");
const route = path.join(fixture, "input.tsx");
const extras = [path.join(fixture, "ProductCard.tsx"), path.join(fixture, "nested", "BuyBox.tsx")];

describe("pluggable backend seam", () => {
  it("registers the built-in typescript backend", () => {
    expect(listBackends()).toContain("typescript");
    expect(createBackend("typescript", { fileNames: [route], supportDir })).toBeInstanceOf(TsBackend);
  });

  it("throws a helpful error for an unknown backend", () => {
    expect(() => createBackend("does-not-exist", { fileNames: [], supportDir })).toThrow(
      /Unknown compiler backend "does-not-exist".*typescript/s,
    );
  });

  it("analyzes through a backend selected by name", () => {
    const result = analyze({ fileName: route, supportDir, schema: mockSchema, extraFiles: extras, backend: "typescript" });
    expect(result.operations[0]!.document).toContain("title");
  });

  it("analyzes through a backend passed as a factory, and disposes it", () => {
    let disposed = false;
    const factory = (opts: Parameters<typeof createBackend>[1]): GraphCompilerBackend => {
      const inner = new TsBackend(opts);
      return new Proxy(inner, {
        get(target, prop) {
          if (prop === "dispose") return () => { disposed = true; };
          return Reflect.get(target, prop) as unknown;
        },
      });
    };
    const result = analyze({ fileName: route, supportDir, schema: mockSchema, extraFiles: extras, backend: factory });
    expect(result.operations[0]!.document).toContain("featuredImage");
    expect(disposed).toBe(true);
  });

  it("a registered custom backend is reachable by name", () => {
    registerBackend("typescript-clone", (opts) => new TsBackend(opts));
    expect(listBackends()).toContain("typescript-clone");
    const result = analyze({ fileName: route, supportDir, schema: mockSchema, extraFiles: extras, backend: "typescript-clone" });
    expect(result.operations[0]!.document).toContain("minVariantPrice");
  });

  it("analyzeWithTs stays pinned to the typescript backend", () => {
    const result = analyzeWithTs({ fileName: route, supportDir, schema: mockSchema, extraFiles: extras });
    expect(result.operations[0]!.document).toContain("url");
  });
});
