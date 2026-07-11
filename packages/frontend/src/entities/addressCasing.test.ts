import { describe, expect, it } from "vitest";
import { buildLowerCaseIndex, resolvePresentId } from "./addressCasing.js";

describe("resolvePresentId", () => {
  it("returns the present-side representation for an exact match", () => {
    expect(resolvePresentId("0xabc", new Set(["0xabc"]))).toBe("0xabc");
  });

  it("matches case-insensitively and returns the present-side casing", () => {
    expect(resolvePresentId("0xabc", new Set(["0xABC"]))).toBe("0xABC");
  });

  it("returns undefined when no candidate matches even case-insensitively", () => {
    expect(resolvePresentId("0xabc", new Set(["0xdef"]))).toBeUndefined();
  });

  it("returns undefined for an empty present set", () => {
    expect(resolvePresentId("0xabc", new Set())).toBeUndefined();
  });

  it("accepts a plain iterable (not just a Set)", () => {
    expect(resolvePresentId("0xabc", ["0xABC", "0xdef"])).toBe("0xABC");
  });

  it("matches an empty-string id against an empty-string present entry", () => {
    // 境界: 空文字も普通の文字列として扱う（特別な弾き方はしない）。
    expect(resolvePresentId("", new Set([""]))).toBe("");
  });

  it("returns undefined for an empty-string id when present has no empty entry", () => {
    expect(resolvePresentId("", new Set(["0xabc"]))).toBeUndefined();
  });

  it("does NOT trim whitespace (only case is ignored, not surrounding spaces)", () => {
    // 表記揺れのうち吸収するのは大文字小文字だけ。前後空白は別物として扱う
    // （このヘルパーの責務境界を明確化する回帰テスト）。
    expect(resolvePresentId(" 0xabc", new Set(["0xabc"]))).toBeUndefined();
    expect(resolvePresentId("0xabc", new Set(["0xabc "]))).toBeUndefined();
  });

  it("returns the FIRST case-insensitive match in iteration order on a collision", () => {
    // present 側に大文字小文字だけ違う重複が混在する場合、resolvePresentId は
    // 走査順で最初に一致した表記を返す（buildLowerCaseIndex の「後勝ち」とは
    // 逆になる。両ヘルパーの衝突時の解決順が異なることを明示しておく）。
    expect(resolvePresentId("0xabc", ["0xABC", "0xAbc", "0xabc"])).toBe("0xABC");
  });
});

describe("buildLowerCaseIndex", () => {
  it("maps each lower-cased id to its original representation", () => {
    const index = buildLowerCaseIndex(["0xABC", "0xDef"]);
    expect(index.get("0xabc")).toBe("0xABC");
    expect(index.get("0xdef")).toBe("0xDef");
  });

  it("returns an empty map for an empty iterable", () => {
    expect(buildLowerCaseIndex([]).size).toBe(0);
  });

  it("keeps the last representation when duplicates differ only by case", () => {
    const index = buildLowerCaseIndex(["0xABC", "0xAbC", "0xabc"]);
    expect(index.get("0xabc")).toBe("0xabc");
    expect(index.size).toBe(1);
  });

  it("indexes an empty-string id under an empty-string key", () => {
    const index = buildLowerCaseIndex([""]);
    expect(index.get("")).toBe("");
    expect(index.size).toBe(1);
  });

  it("does NOT trim whitespace: space-variant ids get distinct keys", () => {
    // 前後空白は正規化しない。空白違いは別キーとして共存する
    // （resolvePresentId 側と同じ責務境界の確認）。
    const index = buildLowerCaseIndex(["0xabc", " 0xabc", "0xabc "]);
    expect(index.size).toBe(3);
    expect(index.get("0xabc")).toBe("0xabc");
    expect(index.get(" 0xabc")).toBe(" 0xabc");
    expect(index.get("0xabc ")).toBe("0xabc ");
  });
});
