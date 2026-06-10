import { describe, it, expect } from "vitest";
import { buildSchema, introspectionFromSchema } from "graphql";
import { generateSchemaModel, type IntrospectionSchema } from "@gleanql/codegen";
import { evalSchemaModel } from "../src/emit.js";
import { rwsdk, reactRouter, resolvePreset } from "../src/presets/index.js";
import type { PresetEmitContext } from "../src/types.js";

const schemaModel = evalSchemaModel(
  generateSchemaModel(
    introspectionFromSchema(
      buildSchema(`type Query { product(handle: String!): Product } type Product { id: ID! title: String! }`),
    ).__schema as unknown as IntrospectionSchema,
  ),
);
const ctx: PresetEmitContext = { schemaModel, operations: {}, endpoint: "/api/graphql" };

describe("rwsdk preset (RSC)", () => {
  const p = rwsdk();
  it("scans src, uses the rwsdk request scope, and emits RSC glue + ./server export", () => {
    expect(p.appDir).toBe("src");
    expect(p.requestScope).toBe("rwsdk");
    expect(p.emitClientGlue(ctx).js).toContain("GraphHydrator"); // RSC client glue
    expect(p.emitServerGlue?.(ctx)?.js).toContain("GraphHydrate");
    expect(p.extraExports?.()).toHaveProperty(["./server"]);
  });
  it("provides a route transform (auto-inject)", () => {
    expect(typeof p.transformRoute).toBe("function");
    const out = p.transformRoute!(`export function ProductPage(){return null;}`, "ProductPage.tsx", new Set(["ProductPage"]));
    expect(out).toContain("withGraphHydration");
  });
});

describe("react-router preset (isomorphic SSR)", () => {
  const p = reactRouter();
  it("scans app, points the accessor at the shared scope module, and has no server glue/transform", () => {
    expect(p.appDir).toBe("app");
    expect(p.requestScope).toEqual({ import: "activeGraph", from: "~/graph-scope" });
    expect(p.emitServerGlue).toBeUndefined();
    expect(p.transformRoute).toBeUndefined();
    expect(p.extraExports).toBeUndefined();
  });
  it("emits SPA client glue that shares the scope (no private singleton, no use client)", () => {
    const js = p.emitClientGlue(ctx).js;
    expect(js).not.toContain('"use client"');
    expect(js).toContain('import { scope } from "~/graph-scope"');
    expect(js).toContain("createGraphClient({ schema, operations, endpoint:");
    expect(js).toContain("scope })"); // the shared scope is passed in
    expect(js).toContain("export const hydrate = __glean.hydrate;");
  });
  it("honors a custom scope module + appDir", () => {
    const custom = reactRouter({ scopeModule: "~/lib/g", appDir: "src" });
    expect(custom.appDir).toBe("src");
    expect(custom.requestScope).toEqual({ import: "activeGraph", from: "~/lib/g" });
    expect(custom.emitClientGlue(ctx).js).toContain('import { scope } from "~/lib/g"');
  });
});

describe("resolvePreset", () => {
  it("resolves built-in names and passes objects through", () => {
    expect(resolvePreset("rwsdk").name).toBe("rwsdk");
    expect(resolvePreset("react-router").name).toBe("react-router");
    expect(resolvePreset().name).toBe("rwsdk"); // default
    const custom = reactRouter({ scopeModule: "~/x" });
    expect(resolvePreset(custom)).toBe(custom);
  });
});
