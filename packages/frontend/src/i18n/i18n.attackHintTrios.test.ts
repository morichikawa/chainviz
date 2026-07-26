// Issue #413 テスト強化: 攻撃手法アンカーの文言のうち、prefix/term/suffix の
// 3分割キー（Issue #341 の `legend.hint.*` と同じパターン）が両言語で成立して
// いることを固定する。
//
// 3分割は「文の途中に GlossaryTerm を挟む」ためだけの実装上の分割なので、
// 個々のキーを見ても壊れていることが分からない。組み立てた1文として:
//
// - ja は3つとも埋まっていて、用語名がそのまま文に含まれる
// - en は語順の都合で suffix を空にすることがある（`legend.eclipseHint.suffix`。
//   意図的な空文字の一覧は i18n.empty-string.test.ts が別途固定）。空でも
//   文が途切れず、和文が混入していない
//
// という条件を見る（CLAUDE.md「1ファイル1責務」: 空文字の境界そのものは
// i18n.empty-string.test.ts、アンカーのDOM上の位置は各コンポーネントの
// *.test.tsx が扱う）。
import { describe, expect, it } from "vitest";
import { translate } from "./i18n.js";
import { LANGUAGES, type Language, type MessageKey, messages } from "./messages.js";

/** 3分割ヒントの組（Issue #413 で追加した3組）のキー接頭辞。 */
const HINT_TRIO_BASES = [
  "legend.eclipseHint",
  "tx.lifecycle.doubleSpendHint",
  "mempoolPanel.frontRunningHint",
] as const;

/** アンカー行の見出しだけの（3分割ではない）キー。 */
const HINT_LABEL_KEYS = [
  "field.headTipAttackHint",
  "chainRibbon.popover.longRangeHint",
] as const satisfies readonly MessageKey[];

// ひらがな(3040-309f)・カタカナ(30a0-30ff)・CJK統合漢字(4e00-9fff)。
const JAPANESE = /[぀-ヿ一-鿿]/;

function part(base: string, suffix: "prefix" | "term" | "suffix"): MessageKey {
  return `${base}.${suffix}` as MessageKey;
}

function compose(base: string, lang: Language): string {
  return (
    translate(part(base, "prefix"), lang) +
    translate(part(base, "term"), lang) +
    translate(part(base, "suffix"), lang)
  );
}

describe("attack hint trios exist as complete prefix/term/suffix sets (Issue #413)", () => {
  it.each(HINT_TRIO_BASES)("%s defines all three parts in both languages", (base) => {
    for (const suffix of ["prefix", "term", "suffix"] as const) {
      const key = part(base, suffix);
      expect(Object.hasOwn(messages, key)).toBe(true);
      for (const lang of LANGUAGES) {
        expect(typeof messages[key][lang]).toBe("string");
      }
    }
  });

  it.each(HINT_TRIO_BASES)("%s keeps every ja part non-empty", (base) => {
    // ja は3分割のまま1文になる（英語のように prefix へ寄せていない）ため、
    // どの部分も空にならない。
    for (const suffix of ["prefix", "term", "suffix"] as const) {
      expect(messages[part(base, suffix)].ja).not.toBe("");
    }
  });

  it.each(HINT_TRIO_BASES)("%s keeps the clickable term label non-empty", (base) => {
    // term が空になるとアンカー（GlossaryTerm の children）が幅ゼロになり、
    // ホバーもクリックもできない導線になってしまう。
    for (const lang of LANGUAGES) {
      expect(messages[part(base, "term")][lang]).not.toBe("");
    }
  });
});

describe("attack hint trios compose into a readable sentence (Issue #413)", () => {
  it.each(HINT_TRIO_BASES)("%s composes a ja sentence containing its term", (base) => {
    const sentence = compose(base, "ja");
    expect(sentence).toContain(messages[part(base, "term")].ja);
    expect(sentence.length).toBeGreaterThan(messages[part(base, "term")].ja.length);
  });

  it.each(HINT_TRIO_BASES)("%s composes an en sentence with no Japanese leaking in", (base) => {
    // suffix.en が意図的に空のとき translate が ja へフォールバックすると、
    // 英語表示の文末に和文が現れる（Issue #341 の再発）。組み立てた文で見る。
    const sentence = compose(base, "en");
    expect(sentence).not.toMatch(JAPANESE);
    expect(sentence).toContain(messages[part(base, "term")].en);
  });

  it.each(HINT_TRIO_BASES)("%s composes different sentences per language", (base) => {
    expect(compose(base, "ja")).not.toBe(compose(base, "en"));
  });

  it.each(HINT_TRIO_BASES)("%s has no doubled space at the en joints", (base) => {
    // prefix が空白で終わり term が空白で始まる（またはその逆）と、英語の
    // 文中に二重空白が現れる。3分割の連結部だけの問題なので合成後に見る。
    expect(compose(base, "en")).not.toContain("  ");
  });
});

describe("attack hint row labels (Issue #413)", () => {
  it.each(HINT_LABEL_KEYS)("%s is non-empty in both languages", (key) => {
    for (const lang of LANGUAGES) {
      expect(messages[key][lang]).not.toBe("");
    }
    expect(messages[key].en).not.toMatch(JAPANESE);
  });
});
