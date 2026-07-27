// longRangeDemo.* 文言（Issue #415）のja/en整合テスト。i18n.test.ts が肥大化
// しているため、この名前空間専用のファイルに分ける（CLAUDE.md の1ファイル
// 1責務。i18n.empty-string.test.ts / i18n.prototype-guard.test.ts と同じ流儀）。
//
// キー一覧はプレフィックスから動的に導出するので、後から longRangeDemo.* が
// 追加されても自動的に検査対象になる（列挙の更新漏れを防ぐ）。
import { describe, expect, it } from "vitest";
import { format, translate } from "./i18n.js";
import { messages, type MessageKey } from "./messages.js";
import { DIVERGE_AT } from "../attack-demo/longRangeAttackDemo.js";

const LONG_RANGE_KEYS = (Object.keys(messages) as MessageKey[]).filter((key) =>
  key.startsWith("longRangeDemo."),
);

/** プレースホルダを持つキーと、その名前（それ以外のキーは持たない想定）。 */
const PLACEHOLDER_KEYS: Record<string, readonly string[]> = {
  "longRangeDemo.checkpointOption": ["number"],
  "longRangeDemo.verdict.naiveResult": ["attackerMax"],
  "longRangeDemo.verdict.protected": ["divergeAt"],
  "longRangeDemo.verdict.vulnerable": ["divergeAt"],
  "longRangeDemo.sharedNote": ["lastShared"],
};

function placeholders(text: string): string[] {
  return (text.match(/\{[^}]*\}/g) ?? []).sort();
}

describe("longRangeDemo.* message keys (Issue #415)", () => {
  it("has a non-empty set of keys to check", () => {
    expect(LONG_RANGE_KEYS.length).toBeGreaterThan(0);
  });

  it.each(LONG_RANGE_KEYS)("has non-empty ja and en translations for %s", (key) => {
    const entry = messages[key];
    expect(entry.ja.trim().length).toBeGreaterThan(0);
    expect(entry.en.trim().length).toBeGreaterThan(0);
  });

  it.each(LONG_RANGE_KEYS)("has distinct ja and en translations for %s", (key) => {
    // この名前空間には言語非依存の固定文字列（送金の例示など）は無いため、
    // ja と en が同一なら訳し忘れ。
    expect(messages[key].ja).not.toBe(messages[key].en);
  });

  it.each(LONG_RANGE_KEYS)("resolves in both languages via translate() for %s", (key) => {
    // 未知キーは translate() がキー文字列自体を返す契約。文言が消えたことを
    // 「キーがそのまま画面に出る」形で検出する。
    expect(translate(key, "ja")).not.toBe(key);
    expect(translate(key, "en")).not.toBe(key);
  });

  it.each(LONG_RANGE_KEYS)("has matching placeholder sets in ja and en for %s", (key) => {
    expect(placeholders(messages[key].ja)).toEqual(placeholders(messages[key].en));
  });

  it.each(LONG_RANGE_KEYS)("carries exactly the expected placeholders for %s", (key) => {
    // format() を通さず直接描画されるキーにプレースホルダが混ざると、生の
    // "{...}" が画面に出る。逆に format() 前提のキーからプレースホルダが
    // 消えると、番号が入らない文言になる（どちらも静かに壊れる）。
    const expected = (PLACEHOLDER_KEYS[key] ?? []).map((name) => `{${name}}`).sort();
    expect(placeholders(messages[key].ja)).toEqual(expected);
  });
});

describe("longRangeDemo dynamic values substitute cleanly", () => {
  it.each(["ja", "en"] as const)(
    "leaves no unresolved placeholder in the checkpoint chip label (%s)",
    (lang) => {
      const filled = format(translate("longRangeDemo.checkpointOption", lang), { number: "3" });
      expect(placeholders(filled)).toEqual([]);
      expect(filled).toContain("3");
    },
  );

  it.each(["ja", "en"] as const)(
    "leaves no unresolved placeholder in the naive verdict (%s)",
    (lang) => {
      const filled = format(translate("longRangeDemo.verdict.naiveResult", lang), {
        attackerMax: "4",
      });
      expect(placeholders(filled)).toEqual([]);
      expect(filled).toContain("4");
    },
  );

  it.each(["ja", "en"] as const)(
    "leaves no unresolved placeholder in either finality verdict (%s)",
    (lang) => {
      for (const key of ["longRangeDemo.verdict.protected", "longRangeDemo.verdict.vulnerable"] as const) {
        const filled = format(translate(key, lang), { divergeAt: String(DIVERGE_AT) });
        expect(placeholders(filled)).toEqual([]);
        expect(filled).toContain(String(DIVERGE_AT));
      }
    },
  );

  it.each(["ja", "en"] as const)(
    "leaves no unresolved placeholder in the shared-section note (%s)",
    (lang) => {
      const filled = format(translate("longRangeDemo.sharedNote", lang), {
        lastShared: String(DIVERGE_AT - 1),
      });
      expect(placeholders(filled)).toEqual([]);
      expect(filled).toContain(String(DIVERGE_AT - 1));
    },
  );

  it.each(["ja", "en"] as const)(
    "words the two finality verdicts differently enough to tell apart (%s)",
    (lang) => {
      // 色に頼らず文言で安全/危険を判別できること（a11y。同一文言だと
      // 判定が切り替わったことが読み上げで伝わらない）。
      expect(translate("longRangeDemo.verdict.protected", lang)).not.toBe(
        translate("longRangeDemo.verdict.vulnerable", lang),
      );
    },
  );
});

describe("longRangeDemo glossary anchor substrings", () => {
  // withTermAnchor は文中の部分文字列を探してアンカー化する。文言からその
  // 部分文字列が消えるとアンカーが静かに外れる（防御的フォールバックで
  // 例外にならない）ため、対象を固定する（Issue #406 の keccak256 アンカー
  // ガードと同じ流儀）。
  it.each([
    { key: "longRangeDemo.title", ja: "ロングレンジ攻撃", en: "long-range attacks" },
    { key: "longRangeDemo.checkpointHeading", ja: "確定(finality)", en: "finality" },
    { key: "longRangeDemo.whoDecides", ja: "attestation", en: "attestation" },
  ] as const)("keeps the anchored substring in both languages of $key", ({ key, ja, en }) => {
    expect(messages[key].ja).toContain(ja);
    expect(messages[key].en).toContain(en);
  });
});
