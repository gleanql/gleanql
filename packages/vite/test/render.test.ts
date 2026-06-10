import { describe, it, expect } from "vitest";
import type { IntrospectionTypeRef } from "@gleanql/codegen";
import { renderTs, renderTsInner, namedTypeName } from "../src/render.js";

const nn = (of: IntrospectionTypeRef): IntrospectionTypeRef => ({ kind: "NON_NULL", ofType: of });
const list = (of: IntrospectionTypeRef): IntrospectionTypeRef => ({ kind: "LIST", ofType: of });
const scalar = (name: string): IntrospectionTypeRef => ({ kind: "SCALAR", name });
const obj = (name: string): IntrospectionTypeRef => ({ kind: "OBJECT", name });

describe("renderTs", () => {
  it("renders scalar/object nullability", () => {
    expect(renderTs(scalar("String"))).toBe("string | null");
    expect(renderTs(nn(scalar("String")))).toBe("string");
    expect(renderTs(scalar("ID"))).toBe("string | null");
    expect(renderTs(nn(obj("Product")))).toBe("Product");
    expect(renderTs(obj("Image"))).toBe("Image | null");
  });

  it("renders lists with correct element nullability", () => {
    expect(renderTs(nn(list(nn(obj("Product")))))).toBe("Product[]"); // [Product!]!
    expect(renderTs(list(nn(scalar("String"))))).toBe("string[] | null"); // [String!]
    expect(renderTs(nn(list(obj("Product"))))).toBe("(Product | null)[]"); // [Product]!
  });

  it("unknown scalars fall back to string", () => {
    expect(renderTs(nn(scalar("DateTime")))).toBe("string");
  });
});

describe("renderTsInner (non-null form, for root accessor returns)", () => {
  it("strips the top-level null", () => {
    expect(renderTsInner(obj("Product"))).toBe("Product");
    expect(renderTsInner(nn(obj("Product")))).toBe("Product");
    expect(renderTsInner(nn(list(nn(obj("Product")))))).toBe("Product[]");
  });
});

describe("namedTypeName", () => {
  it("unwraps list/non-null to the named type", () => {
    expect(namedTypeName(nn(list(nn(obj("Product")))))).toBe("Product");
    expect(namedTypeName(scalar("ID"))).toBe("ID");
  });
});
