// keccak256Hex の既知ベクトルテスト（Issue #401。UX設計「テスト観点」§8）。
// @noble/hashes 自体の正しさを検証するテストではなく、薄いラッパーの
// 入出力形式（UTF-8入力・0x+64桁hex出力）が既知の参照値と一致することの
// 固定である。値は @noble/hashes 実装で実際に計算し確認済み。
import { describe, expect, it } from "vitest";
import { keccak256Hex } from "./keccak256.js";

describe("keccak256Hex", () => {
  it("hashes the empty string to the well-known keccak256('') vector", () => {
    expect(keccak256Hex("")).toBe(
      "0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470",
    );
  });

  it("hashes 'abc' to the well-known keccak256('abc') vector", () => {
    expect(keccak256Hex("abc")).toBe(
      "0x4e03657aea45a94fc7d47ba826c8d667c0d1e6e33a64a036ec44f58fa12d6c45",
    );
  });

  it("returns a 0x-prefixed 64-hex-character string (32 bytes) for arbitrary input", () => {
    const hash = keccak256Hex("1|0x0000000000000000000000000000000000000000000000000000000000000000|Alice → Bob: 5 ETH");
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("changes completely for a 1-character difference in the input (avalanche effect)", () => {
    const original = keccak256Hex("Alice → Bob: 5 ETH");
    const tampered = keccak256Hex("Alice → Bob: 6 ETH");
    expect(tampered).not.toBe(original);
  });

  it("is deterministic: the same input always yields the same hash", () => {
    expect(keccak256Hex("same input")).toBe(keccak256Hex("same input"));
  });
});
