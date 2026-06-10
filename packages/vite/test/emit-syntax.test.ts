import { describe, it, expect } from "vitest";
import * as esbuild from "esbuild";
import { buildSchema, introspectionFromSchema } from "graphql";
import { generateSchemaModel, generateTypes, generateGraph, type IntrospectionSchema } from "@gleanql/codegen";
import type { OperationArtifact } from "@gleanql/core";
import {
  evalSchemaModel,
  genGeneratedJs,
  genOperationsJs,
  genOperationsDts,
  genIndexDts,
  genClientJs,
  genClientDts,
  genClientSpaJs,
  genClientSpaDts,
  genServerJs,
  genServerDts,
  genTestingJs,
  genTestingDts,
  genPersistedManifest,
  renderReadMask,
  renderOperationTypes,
} from "../src/emit.js";

/**
 * Every generated module, parse-validated. The emitters are template strings —
 * this is the guarantee that a template typo can never ship a syntactically
 * broken module: each emitter's output (across its option matrix) must survive
 * esbuild's parser in the loader it will actually be consumed with.
 */

const SDL = /* GraphQL */ `
  type Query {
    product(handle: String!): Product
    todos: [Todo!]
  }
  type Mutation { toggleTodo(id: ID!): Todo }
  type Subscription { todoChanged(id: ID!): Todo }
  type Product { id: ID!  title: String!  priceRange: ProductPriceRange! }
  type ProductPriceRange { minVariantPrice: MoneyV2! }
  type MoneyV2 { amount: String! }
  type Todo { id: ID!  title: String!  completed: Boolean! }
`;

const introspection = introspectionFromSchema(buildSchema(SDL)).__schema as unknown as IntrospectionSchema;
const schemaModelSrc = generateSchemaModel(introspection);
const schemaModel = evalSchemaModel(schemaModelSrc);

const OPS: Record<string, OperationArtifact> = {
  ProductRoute: {
    name: "ProductRoute",
    kind: "query",
    document: 'query ProductRoute($handle: String!) { product(handle: $handle) { title } }',
    hash: "abc123",
    variablesFactory: {
      exportName: "getProductRouteVariables",
      source: "export function getProductRouteVariables(ctx) { return { handle: ctx.params.handle }; }",
    },
    readMap: { ProductHero: ["Product.title"] },
    selection: { typeName: "Query", fields: [{ name: "product", selection: { typeName: "Product", fields: [{ name: "title" }] } }] },
    stats: { fieldCount: 1, rootCount: 1, connectionCount: 0 },
  },
};

const parses = async (source: string, loader: "js" | "ts" | "tsx") => esbuild.transform(source, { loader });

const HOOK_MATRIX = [
  { mutation: false, subscription: false },
  { mutation: true, subscription: false },
  { mutation: true, subscription: true },
];

const CUSTOM_SCOPE = { import: "activeGraph", from: "@/graph-scope" } as const;
const OP_TYPES = renderOperationTypes(OPS, schemaModel);

describe("every generated module parses", () => {
  it("client glue (RSC + SPA, full option matrix)", async () => {
    for (const caps of HOOK_MATRIX) {
      for (const knobs of [
        {},
        { maxCacheRecords: 5000, persisted: true, gcKeepPages: 2, masking: true },
      ]) {
        const options = { endpoint: "/graphql", caps, ...knobs };
        await parses(genClientJs(options), "js");
        await parses(genClientSpaJs(CUSTOM_SCOPE, options), "js");
        await parses(genClientDts(caps, OP_TYPES), "ts");
        await parses(genClientSpaDts(caps, OP_TYPES), "ts");
      }
    }
  });

  it("server glue (both request scopes)", async () => {
    await parses(genServerJs(), "js");
    await parses(genServerJs(CUSTOM_SCOPE), "js");
    await parses(genServerDts(), "ts");
  });

  it("testing entrypoint", async () => {
    await parses(genTestingJs(), "js");
    await parses(genTestingDts(), "ts");
  });

  it("accessor + barrel types (both request scopes)", async () => {
    await parses(genGeneratedJs(schemaModel, OPS), "js");
    await parses(genGeneratedJs(schemaModel, OPS, CUSTOM_SCOPE), "js");
    await parses(genIndexDts(introspection, schemaModel), "ts");
  });

  it("operations data module (with and without read-mask)", async () => {
    await parses(genOperationsJs(OPS), "js");
    await parses(genOperationsJs(OPS, renderReadMask(OPS, schemaModel)), "js");
    await parses(genOperationsDts(false), "ts");
    await parses(genOperationsDts(true), "ts");
  });

  it("codegen sources (schema model, branded types, graph stub)", async () => {
    await parses(schemaModelSrc, "ts");
    await parses(generateTypes(introspection), "ts");
    await parses(generateGraph(introspection), "ts");
  });

  it("persisted manifest is valid JSON keyed by hash", () => {
    const manifest = JSON.parse(genPersistedManifest(OPS)) as Record<string, string>;
    expect(manifest["abc123"]).toContain("query ProductRoute");
  });
});
