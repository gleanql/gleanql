import { describe, it, expect } from "vitest";
import { buildSchema, introspectionFromSchema } from "graphql";
import { generateSchemaModel, type IntrospectionSchema } from "@gleanql/codegen";
import type { OperationArtifact } from "@gleanql/core";
import { evalSchemaModel, genGeneratedJs, genOperationsJs, genIndexDts, genOperationsDts, genClientJs, genClientDts, genServerJs, genServerDts, genClientSpaJs, genClientSpaDts } from "../src/emit.js";

const SDL = /* GraphQL */ `
  type Query {
    product(handle: String!): Product
    collection(handle: String!): Collection
  }
  type Product { id: ID!  title: String!  featuredImage: Image  priceRange: ProductPriceRange! }
  type Collection { id: ID!  title: String!  products(first: Int!): ProductConnection! }
  type ProductConnection { nodes: [Product!]! }
  type Image { url: String! }
  type ProductPriceRange { minVariantPrice: MoneyV2! }
  type MoneyV2 { amount: String! }
`;

const introspection = introspectionFromSchema(buildSchema(SDL)).__schema as unknown as IntrospectionSchema;
const schemaModel = evalSchemaModel(generateSchemaModel(introspection));

describe("evalSchemaModel", () => {
  it("evaluates the generated SchemaModel source into a live model", () => {
    expect(schemaModel.queryType).toBe("Query");
    expect(Object.keys(schemaModel.getType("Query")?.fields ?? {})).toEqual(["product", "collection"]);
    expect(schemaModel.hasId("Product")).toBe(true);
  });
});

describe("genIndexDts", () => {
  const dts = genIndexDts(introspection, schemaModel);

  it("types each root accessor as non-null with its arguments", () => {
    expect(dts).toContain("product(args: { handle: string }): Product;");
    expect(dts).toContain("collection(args: { handle: string }): Collection;");
  });

  it("imports the branded types it references and re-exports the schema", () => {
    expect(dts).toMatch(/import type \{[^}]*Product[^}]*\} from "\.\/generated\/schema";/);
    expect(dts).toContain('export * from "./generated/schema";');
  });

  it("re-exports the real runtime API + operations from source (not a hand-curated subset)", () => {
    expect(dts).toContain('export * from "./src/index.js";');
    expect(dts).toContain('export * from "./generated/operations";');
  });
});

describe("genClientJs", () => {
  const js = genClientJs({ endpoint: "/api/graphql" });

  it("is a thin RSC shim over the shared client factory (logic lives in source, not strings)", () => {
    expect(js.trimStart()).toMatch(/^\/\/ GENERATED[^\n]*\n"use client";/);
    expect(js).toContain('import { createGraphClient } from "../src/glue-client.js"');
    expect(js).toContain('createGraphClient({ schema, operations, endpoint: "/api/graphql" })'); // no scope ⇒ private singleton
    expect(js).not.toContain("scope"); // RSC private singleton, not a shared scope
  });

  it("re-exports the RSC surface (GraphHydrator + useGlean + refresh + list-root splices)", () => {
    expect(js).toContain("export const GraphHydrator = __glean.GraphHydrator;");
    expect(js).toContain("export const useGlean = __glean.useGlean;");
    expect(js).toContain("export const refresh = __glean.refresh;");
    expect(js).toContain("export const appendToRoot = __glean.appendToRoot;");
    expect(js).toContain("export const removeFromRoot = __glean.removeFromRoot;");
  });

  it("types the generated client entrypoint", () => {
    const dts = genClientDts();
    expect(dts).toContain("export declare function GraphHydrator(props: { payload: GraphHydrationPayload }): null;");
    expect(dts).toContain("export declare function useGlean(component?: string): Graph | undefined;");
    expect(dts).toContain("export declare function refresh(target?: string | { component: string }): Promise<void>;");
    expect(dts).toContain("export declare function appendToRoot(rootField: string, entity: unknown, options?: { prepend?: boolean; at?: number }): void;");
    expect(dts).toContain("export declare function removeFromRoot(rootField: string, entity: unknown): void;");
  });

  it("persisted mode bakes `persisted: true` into the client config (both glue flavours)", () => {
    expect(genClientJs({ endpoint: "/graphql", persisted: true })).toContain(
      'createGraphClient({ schema, operations, endpoint: "/graphql", persisted: true })',
    );
    expect(
      genClientSpaJs({ import: "activeGraph", from: "~/graph-scope" }, { endpoint: "/graphql", persisted: true }),
    ).toContain('createGraphClient({ schema, operations, endpoint: "/graphql", scope, persisted: true })');
    expect(js).not.toContain("persisted"); // off by default
  });
});

describe("genClientSpaJs (isomorphic / non-RSC glue)", () => {
  const js = genClientSpaJs({ import: "activeGraph", from: "~/graph-scope" }, { endpoint: "/api/graphql" });

  it("is a plain (non-use-client) shim that passes the app's SHARED scope", () => {
    expect(js).not.toContain('"use client"');
    expect(js).toContain('import { createGraphClient } from "../src/glue-client.js"');
    expect(js).toContain('import { scope } from "~/graph-scope"');
    expect(js).toContain('createGraphClient({ schema, operations, endpoint: "/api/graphql", scope })');
  });

  it("re-exports the isomorphic surface (hydrate + useGlean + refresh + splices, no GraphHydrator)", () => {
    expect(js).toContain("export const hydrate = __glean.hydrate;");
    expect(js).toContain("export const useGlean = __glean.useGlean;");
    expect(js).toContain("export const refresh = __glean.refresh;");
    expect(js).toContain("export const appendToRoot = __glean.appendToRoot;");
    expect(js).toContain("export const removeFromRoot = __glean.removeFromRoot;");
    expect(js).not.toContain("GraphHydrator"); // no flight-prop hydrator in the SPA entry
  });

  it("rejects the rwsdk scope (a non-RSC framework cannot use it)", () => {
    expect(() => genClientSpaJs("rwsdk", { endpoint: "/graphql" })).toThrow(/requires requestScope/);
  });

  it("types the SPA client entrypoint", () => {
    const dts = genClientSpaDts();
    expect(dts).toContain("export declare function hydrate(payload: GraphHydrationPayload | undefined): void;");
    expect(dts).toContain("export declare function useGlean(component?: string): Graph;");
    expect(dts).toContain("export declare function refresh(target?: string | { component: string }): Promise<void>;");
  });
});

describe("genServerJs", () => {
  const js = genServerJs();

  it("is a thin shim over the shared server factory", () => {
    expect(js).toContain('import { createGraphServer } from "../src/glue-server.js"');
    expect(js).toContain('import { GraphHydrator } from "./client.js";');
    expect(js).toContain("createGraphServer({ GraphHydrator, getActive: __activeOrNull })");
    expect(js).toContain("export const GraphHydrate = __glean.GraphHydrate;");
    expect(js).toContain("export const withGraphHydration = __glean.withGraphHydration;");
  });

  it("defaults the request scope to RedwoodSDK and returns null off-graph (no throw)", () => {
    expect(js).toContain('import { requestInfo } from "rwsdk/worker";');
    expect(js).toContain("function __activeOrNull()");
    expect(js).not.toContain("Error("); // resolver returns null, never throws
  });

  it("emits a custom resolver when requestScope is { import, from }", () => {
    const custom = genServerJs({ import: "activeGraph", from: "@/graph-scope" });
    expect(custom).toContain('import { activeGraph } from "@/graph-scope";');
    expect(custom).toContain("return activeGraph() || null;");
    expect(custom).not.toContain("rwsdk/worker");
  });

  it("types the generated server entrypoint", () => {
    const dts = genServerDts();
    expect(dts).toContain("export declare function GraphHydrate(");
    expect(dts).toContain("export declare function withGraphHydration<P>(Page: ComponentType<P>): ComponentType<P>;");
  });
});

describe("genOperationsDts", () => {
  it("types operations + schema for the client-safe entrypoint", () => {
    const dts = genOperationsDts();
    expect(dts).toContain("export declare const operations: Record<string, CompiledOperation>;");
    expect(dts).toContain("export declare const schema: SchemaModel;");
    expect(dts).toContain('import type { CompiledOperation } from "../src/index.js";');
  });
});

describe("genGeneratedJs", () => {
  const ops: Record<string, OperationArtifact> = {
    ProductRoute: {
      name: "ProductRoute",
      kind: "query",
      document: "query ProductRoute($handle: String!) { product(handle: $handle) { title } }",
      hash: "abc123",
      variablesFactory: { exportName: "getProductRouteVariables", source: "export function getProductRouteVariables(ctx) { return { handle: ctx.params.handle }; }" },
      readMap: { ProductHero: ["Product.title"] },
      selection: { typeName: "Query", fields: [{ name: "product", selection: { typeName: "Product", fields: [{ name: "title" }] } }] },
      stats: { fieldCount: 1, rootCount: 1, connectionCount: 0 },
    },
  };
  const js = genGeneratedJs(schemaModel, ops);

  it("emits one accessor per root field delegating to the active runtime", () => {
    expect(js).toContain("product(args) { return __active().graph.product(args); }");
    expect(js).toContain("collection(args) { return __active().graph.collection(args); }");
  });

  it("re-exports the portable data (operations + schema) from the data module", () => {
    expect(js).toContain('export { schema, operations } from "./operations.js"');
  });

  it("defaults the request scope to RedwoodSDK's requestInfo", () => {
    expect(js).toContain('import { requestInfo } from "rwsdk/worker";');
    expect(js).toContain("requestInfo.ctx.__graph");
  });

  it("emits a custom resolver import when requestScope is { import, from }", () => {
    const custom = genGeneratedJs(schemaModel, ops, { import: "activeGraph", from: "@/graph-scope" });
    expect(custom).toContain('import { activeGraph } from "@/graph-scope";');
    expect(custom).toContain("const a = activeGraph();");
    expect(custom).not.toContain("rwsdk/worker");
    // the accessor delegation is unchanged — only the resolver differs.
    expect(custom).toContain("product(args) { return __active().graph.product(args); }");
  });
});

describe("genOperationsJs", () => {
  const ops: Record<string, OperationArtifact> = {
    ProductRoute: {
      name: "ProductRoute",
      kind: "query",
      document: "query ProductRoute($handle: String!) { product(handle: $handle) { title } }",
      hash: "abc123",
      variablesFactory: { exportName: "getProductRouteVariables", source: "export function getProductRouteVariables(ctx) { return { handle: ctx.params.handle }; }" },
      readMap: { ProductHero: ["Product.title"] },
      selection: { typeName: "Query", fields: [{ name: "product", selection: { typeName: "Product", fields: [{ name: "title" }] } }] },
      stats: { fieldCount: 1, rootCount: 1, connectionCount: 0 },
    },
  };
  const data = genOperationsJs(ops);

  it("inlines the variables factory + operations map and re-exports schema (no framework import)", () => {
    expect(data).toContain("function getProductRouteVariables(ctx)"); // export stripped
    expect(data).toContain('"ProductRoute": { name: "ProductRoute", kind: "query"');
    expect(data).toContain("variables: getProductRouteVariables");
    expect(data).toContain('export { schema } from "./schema-model.js"');
    expect(data).not.toContain("rwsdk/worker"); // client-safe: no request-scope import
  });
});
