import { describe, it, expect } from "vitest";
import { sha256Hex, hashDocument } from "../src/index.js";

// FIPS 180-4 / NIST test vectors.
describe("sha256Hex", () => {
  it("matches the empty-string vector", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it('matches the "abc" vector', () => {
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("matches the two-block (448-bit) vector", () => {
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("handles exact-block-boundary lengths (55/56/64 bytes)", () => {
    // Lengths around the padding boundary are where implementations break.
    expect(sha256Hex("a".repeat(55))).toBe("9f4390f8d30c2dd92ec9f095b65e2b9ae9b0a925a5258e241c9f1e910f734318");
    expect(sha256Hex("a".repeat(56))).toBe("b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a");
    expect(sha256Hex("a".repeat(64))).toBe("ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb");
  });

  it("UTF-8 encodes multibyte input", () => {
    // sha256("é") over UTF-8 bytes 0xC3 0xA9 (reference: node crypto).
    expect(sha256Hex("é")).toBe("4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c");
  });

  it("hashDocument is sha256 of the document", () => {
    const doc = "query Q { product { id } }";
    expect(hashDocument(doc)).toBe(sha256Hex(doc));
    expect(hashDocument(doc)).toMatch(/^[0-9a-f]{64}$/);
  });
});
