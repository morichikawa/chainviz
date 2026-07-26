// eclipseDemo.* 文言（Issue #416）のja/en整合テスト。i18n.test.ts が肥大化
// しているため、この名前空間専用のファイルに分ける（CLAUDE.md の1ファイル
// 1責務。i18n.empty-string.test.ts / i18n.prototype-guard.test.ts と同じ流儀）。
//
// キー一覧はプレフィックスから動的に導出するので、後から eclipseDemo.* が
// 追加されても自動的に検査対象になる（列挙の更新漏れを防ぐ）。
import { describe, expect, it } from "vitest";
import { format, translate } from "./i18n.js";
import { messages, type MessageKey } from "./messages.js";
import {
  FAKE_CHAIN_BLOCK_KEYS,
  REAL_CHAIN_BLOCK_KEYS,
} from "../attack-demo/eclipseAttackDemo.js";

const ECLIPSE_KEYS = (Object.keys(messages) as MessageKey[]).filter((key) =>
  key.startsWith("eclipseDemo."),
);

/** ja/en で意図的に同一文言のキー（言語に依存しない送金の例示）。 */
const INTENTIONALLY_IDENTICAL: readonly MessageKey[] = [
  "eclipseDemo.block.real.1",
  "eclipseDemo.block.real.2",
  "eclipseDemo.block.real.3",
];

function placeholders(text: string): string[] {
  return (text.match(/\{[^}]*\}/g) ?? []).sort();
}

describe("eclipseDemo.* message keys (Issue #416)", () => {
  it("has a non-empty set of keys to check", () => {
    expect(ECLIPSE_KEYS.length).toBeGreaterThan(0);
  });

  it.each(ECLIPSE_KEYS)("has non-empty ja and en translations for %s", (key) => {
    const entry = messages[key];
    expect(entry.ja.trim().length).toBeGreaterThan(0);
    expect(entry.en.trim().length).toBeGreaterThan(0);
  });

  it.each(ECLIPSE_KEYS)("has matching placeholder sets in ja and en for %s", (key) => {
    const entry = messages[key];
    expect(placeholders(entry.ja)).toEqual(placeholders(entry.en));
  });

  it.each(ECLIPSE_KEYS)("resolves in both languages via translate() for %s", (key) => {
    // 未知キーは translate() がキー文字列自体を返す契約。文言が消えたことを
    // 「キーがそのまま画面に出る」形で検出する。
    expect(translate(key, "ja")).not.toBe(key);
    expect(translate(key, "en")).not.toBe(key);
  });

  it.each(ECLIPSE_KEYS.filter((key) => !INTENTIONALLY_IDENTICAL.includes(key)))(
    "has distinct ja and en translations for %s (translation not forgotten)",
    (key) => {
      expect(messages[key].ja).not.toBe(messages[key].en);
    },
  );

  it.each(INTENTIONALLY_IDENTICAL)(
    "keeps %s intentionally identical in ja and en (allowance does not rot)",
    (key) => {
      expect(messages[key].ja).toBe(messages[key].en);
    },
  );
});

describe("eclipseDemo.occupancy placeholders", () => {
  const PLACEHOLDER_NAMES = ["count", "total", "percent"] as const;

  it.each(["ja", "en"] as const)(
    "keeps the {count}/{total}/{percent} placeholders in %s",
    (lang) => {
      const text = translate("eclipseDemo.occupancy", lang);
      for (const name of PLACEHOLDER_NAMES) {
        expect(text).toContain(`{${name}}`);
      }
    },
  );

  it.each(["ja", "en"] as const)(
    "leaves no unresolved placeholder after format() in %s",
    (lang) => {
      const filled = format(translate("eclipseDemo.occupancy", lang), {
        count: "3",
        total: "8",
        percent: "38",
      });
      // 綴り違い（{cout} 等）が残っていれば生の "{...}" が画面に出る。
      expect(placeholders(filled)).toEqual([]);
      expect(filled).toContain("3");
      expect(filled).toContain("8");
      expect(filled).toContain("38");
    },
  );
});

describe("eclipseDemo pseudo chain block keys", () => {
  const ALL_BLOCK_KEYS = [...REAL_CHAIN_BLOCK_KEYS, ...FAKE_CHAIN_BLOCK_KEYS];

  it.each(ALL_BLOCK_KEYS)("is defined in messages.ts: %s", (key) => {
    expect(Object.prototype.hasOwnProperty.call(messages, key)).toBe(true);
  });

  it.each(["ja", "en"] as const)(
    "renders the real and fake block texts as disjoint sets in %s (the switch is observable)",
    (lang) => {
      const real = REAL_CHAIN_BLOCK_KEYS.map((key) => translate(key, lang));
      const fake = FAKE_CHAIN_BLOCK_KEYS.map((key) => translate(key, lang));
      expect(real.length).toBe(fake.length);
      expect(new Set([...real, ...fake]).size).toBe(real.length + fake.length);
      for (const text of [...real, ...fake]) {
        expect(text.trim().length).toBeGreaterThan(0);
      }
    },
  );
});
