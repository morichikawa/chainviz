// secp256k1.ts の異常入力・境界値の補強テスト（Issue #402 テスト強化）。
// 参照ベクトル・ラウンドトリップ・決定性の基本ケースは secp256k1.test.ts、
// prehash の golden 固定は secp256k1.prehash.test.ts が扱う（CLAUDE.md の
// 1ファイル1責務）。
//
// ここは「不正な長さ・形式のバイト列が来たとき、ラッパーが黙って壊れた
// アドレス／署名を返さず例外で失敗すること」を固定する。圧縮公開鍵→非圧縮
// への展開（`Point.fromBytes`）や recover の署名長チェックはライブラリ側で
// 行われるが、ラッパーがそれらを握りつぶさず素通しすることを回帰として残す
// （実測で throw することを確認済み）。
import { describe, expect, it } from "vitest";
import { deriveAddress, recoverAddress, sign } from "./secp256k1.js";
import { keccak256Hex } from "./keccak256.js";

const VALID_MESSAGE_HASH = keccak256Hex("some message");

describe("deriveAddress rejects malformed secret keys", () => {
  it("throws for a too-short secret key (not 32 bytes)", () => {
    // getPublicKey は 32byte の秘密鍵を要求する。短い値を渡すと展開前に失敗する。
    expect(() => deriveAddress("0x1234")).toThrow();
  });

  it("throws for an odd-length hex string (not decodable to bytes)", () => {
    expect(() => deriveAddress("0xabc")).toThrow();
  });
});

describe("recoverAddress rejects malformed signatures", () => {
  it("throws for a signature that is not 65 bytes (recoverable form)", () => {
    // 圧縮/非圧縮以前に recover は 65byte(r‖s‖recovery) を要求する。
    expect(() => recoverAddress("0x1234", VALID_MESSAGE_HASH)).toThrow();
  });

  it("throws for a 65-byte blob whose r component is out of range (all zeros)", () => {
    const allZero = `0x${"00".repeat(65)}`;
    expect(() => recoverAddress(allZero, VALID_MESSAGE_HASH)).toThrow();
  });

  it("throws for an odd-length signature hex string", () => {
    expect(() => recoverAddress("0xabc", VALID_MESSAGE_HASH)).toThrow();
  });
});

describe("sign rejects malformed inputs", () => {
  it("throws for a too-short secret key", () => {
    expect(() => sign("0x01", VALID_MESSAGE_HASH)).toThrow();
  });
});
