import { describe, expect, it } from "vitest";
import { subtitleEndsWithClientType } from "./subtitle.js";

describe("subtitleEndsWithClientType", () => {
  describe("format matching", () => {
    it("matches the new '{role label} · {clientType}' format (Issue #215)", () => {
      expect(subtitleEndsWithClientType("reth").test("実行クライアント · reth")).toBe(
        true,
      );
      expect(
        subtitleEndsWithClientType("lighthouse").test("Consensus client · lighthouse"),
      ).toBe(true);
    });

    it("matches the legacy fallback format ('{clientType}' alone)", () => {
      // 役割ラベルが解釈できないノードでは subtitle が clientType 単独になる
      // （レガシースナップショット相当）。その形式にも一致する。
      expect(subtitleEndsWithClientType("reth").test("reth")).toBe(true);
    });

    it("does not match a different clientType", () => {
      expect(subtitleEndsWithClientType("reth").test("実行クライアント · lighthouse")).toBe(
        false,
      );
    });
  });

  describe("token boundary (avoid substring false positives)", () => {
    it("does not match when clientType is only a prefix of the trailing token", () => {
      // "reth" が末尾トークンの先頭に含まれるだけのケースを誤検出しない
      // （例: 将来 clientType に "rethink" のような値が来ても事故らない）。
      expect(subtitleEndsWithClientType("reth").test("実行クライアント · rethink")).toBe(
        false,
      );
    });

    it("does not match when clientType is only a suffix of the trailing token", () => {
      // "eth" が末尾トークン "reth" の末尾に含まれるだけのケースを誤検出
      // しない。直前が区切りの空白でなく文字("r")なので `(?:^|\s)` に阻まれる。
      // 部分一致による取り違えの中で最も危険なパターン。
      expect(subtitleEndsWithClientType("eth").test("実行クライアント · reth")).toBe(false);
    });

    it("matches when the role label token happens to equal the clientType", () => {
      // 役割ラベル側に偶然 clientType と同じトークンが現れても、末尾トークンが
      // clientType と一致していれば一致する（末尾判定であることの確認）。
      expect(subtitleEndsWithClientType("reth").test("reth · reth")).toBe(true);
    });

    it("relies on the subtitle being trimmed (trailing whitespace prevents a match)", () => {
      // 末尾に余分な空白がある文字列には一致しない。呼び出し側は textContent を
      // trim する / toHaveText が既定でトリムする前提に依存していることを固定する。
      expect(subtitleEndsWithClientType("reth").test("実行クライアント · reth  ")).toBe(
        false,
      );
    });
  });

  describe("case sensitivity", () => {
    it("is case-sensitive: clientType casing must match the subtitle", () => {
      expect(subtitleEndsWithClientType("Reth").test("実行クライアント · reth")).toBe(
        false,
      );
      expect(subtitleEndsWithClientType("reth").test("実行クライアント · Reth")).toBe(
        false,
      );
    });
  });

  describe("regex special characters in clientType", () => {
    // clientType は将来別チェーンプロファイルで正規表現特殊文字を含みうる
    // （`.` `+` `$` `(` `)` `^` `\` 等）。エスケープが効いていることを検証する。
    it("treats '.' as a literal, not a wildcard", () => {
      expect(subtitleEndsWithClientType("a.b").test("a.b")).toBe(true);
      expect(subtitleEndsWithClientType("a.b").test("aXb")).toBe(false);
    });

    it("treats '+' as a literal, not a quantifier", () => {
      expect(subtitleEndsWithClientType("g+").test("role · g+")).toBe(true);
      // エスケープされていなければ "ggg" に誤って一致してしまう。
      expect(subtitleEndsWithClientType("g+").test("role · ggg")).toBe(false);
    });

    it("treats '$' as a literal, not an anchor", () => {
      expect(subtitleEndsWithClientType("a$b").test("role · a$b")).toBe(true);
      expect(subtitleEndsWithClientType("a$b").test("role · ab")).toBe(false);
    });

    it("treats parentheses as literals, not a group", () => {
      expect(subtitleEndsWithClientType("geth(1)").test("role · geth(1)")).toBe(true);
    });

    it("treats a backslash as a literal", () => {
      expect(subtitleEndsWithClientType("a\\b").test("role · a\\b")).toBe(true);
    });

    it("matches hyphenated clientType names like 'go-ethereum'", () => {
      expect(
        subtitleEndsWithClientType("go-ethereum").test("実行クライアント · go-ethereum"),
      ).toBe(true);
    });
  });

  describe("degenerate input (documented, not reached in practice)", () => {
    it("with an empty clientType, matches an empty subtitle and any trailing whitespace", () => {
      // clientType が空文字列になるのは実運用では起こらない（COMPOSE_NODES /
      // ワールドステートのエンティティ由来で常に非空）。ここでは正規表現が
      // `(?:^|\s)$` に縮退したときの実挙動を固定し、想定外挙動に気付けるように
      // しておく。
      expect(subtitleEndsWithClientType("").test("")).toBe(true);
      expect(subtitleEndsWithClientType("").test("role · ")).toBe(true);
      // 末尾が空白でない通常の subtitle には一致しない。
      expect(subtitleEndsWithClientType("").test("実行クライアント · reth")).toBe(false);
    });
  });
});
