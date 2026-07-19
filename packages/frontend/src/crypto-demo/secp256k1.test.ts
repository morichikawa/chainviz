// secp256k1.ts の薄いラッパーの基本テスト（Issue #402。実装設計メモ
// docs/worklog/issue-402.md「テスト方針」）。@noble/curves 自体の正しさを
// 検証するテストではなく、ラッパーの入出力契約（hex 入出力・アドレス導出・
// 署名→復元のラウンドトリップ）が期待どおりであることの固定である。
import { describe, expect, it } from "vitest";
import { deriveAddress, recoverAddress, sign } from "./secp256k1.js";
import { keccak256Hex } from "./keccak256.js";

const ADDRESS_RE = /^0x[0-9a-f]{40}$/;
const SIGNATURE_RE = /^0x[0-9a-f]{130}$/;

describe("deriveAddress", () => {
  it("derives the well-known address for the private key 0x1 (public reference vector)", () => {
    // 秘密鍵 = 1 は複数の公開資料で言及される「よく知られたアドレス」の
    // 参照ベクトル。ライブラリの入れ替え等で導出結果が変わっていないかの
    // 固定に使う。
    const secretKey = `0x${"0".repeat(63)}1`;
    expect(deriveAddress(secretKey)).toBe("0x7e5f4552091a69125d5dfcb7b8c2659029395bdf");
  });

  it("returns a 0x-prefixed 40-hex-character address for an arbitrary secret key", () => {
    const secretKey = keccak256Hex("some sandbox label");
    expect(deriveAddress(secretKey)).toMatch(ADDRESS_RE);
  });

  it("is deterministic: the same secret key always yields the same address", () => {
    const secretKey = keccak256Hex("determinism check");
    expect(deriveAddress(secretKey)).toBe(deriveAddress(secretKey));
  });

  it("derives different addresses for different secret keys", () => {
    const a = keccak256Hex("key a");
    const b = keccak256Hex("key b");
    expect(deriveAddress(a)).not.toBe(deriveAddress(b));
  });
});

describe("sign", () => {
  it("returns a 0x-prefixed 65-byte (130 hex char) recoverable signature", () => {
    const secretKey = keccak256Hex("signer");
    const messageHash = keccak256Hex("hello world");
    expect(sign(secretKey, messageHash)).toMatch(SIGNATURE_RE);
  });

  it("is deterministic: signing the same message hash with the same key twice yields the same signature", () => {
    const secretKey = keccak256Hex("signer");
    const messageHash = keccak256Hex("hello world");
    expect(sign(secretKey, messageHash)).toBe(sign(secretKey, messageHash));
  });

  it("produces a different signature for a different message hash", () => {
    const secretKey = keccak256Hex("signer");
    expect(sign(secretKey, keccak256Hex("a"))).not.toBe(sign(secretKey, keccak256Hex("b")));
  });
});

describe("sign + recoverAddress round trip", () => {
  it("recovers the signer's own address when the message hash is unchanged", () => {
    const secretKey = keccak256Hex("alice-like key");
    const address = deriveAddress(secretKey);
    const messageHash = keccak256Hex("Alice sends 1 ETH to Bob");
    const signature = sign(secretKey, messageHash);
    expect(recoverAddress(signature, messageHash)).toBe(address);
  });

  it("recovers a different (unrelated) address when the message hash is tampered with", () => {
    const secretKey = keccak256Hex("alice-like key");
    const address = deriveAddress(secretKey);
    const original = keccak256Hex("Alice sends 1 ETH to Bob");
    const tampered = keccak256Hex("Alice sends 100 ETH to Mallory");
    const signature = sign(secretKey, original);
    expect(recoverAddress(signature, tampered)).not.toBe(address);
  });

  it("recovers the address of whichever key actually produced the signature, not a claimed one", () => {
    // 「誰の鍵で署名したか」だけが復元結果を決める。メッセージの中身に
    // 誰の名前が書いてあるかは一切関係しない、という ecrecover の性質。
    const aliceKey = keccak256Hex("alice");
    const attackerKey = keccak256Hex("attacker");
    const attackerAddress = deriveAddress(attackerKey);
    const messageHash = keccak256Hex("Alice sends 1 ETH to Bob");
    const signature = sign(attackerKey, messageHash);
    expect(recoverAddress(signature, messageHash)).toBe(attackerAddress);
    expect(recoverAddress(signature, messageHash)).not.toBe(deriveAddress(aliceKey));
  });
});
