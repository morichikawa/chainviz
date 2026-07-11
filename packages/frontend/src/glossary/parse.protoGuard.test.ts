import { describe, expect, it } from "vitest";
import { mergeGlossaries, parseGlossaryYaml } from "./parse.js";

// 回帰テスト（Issue #264）: `GlossaryProvider.tsx` の `lookup` と同様、
// `parseGlossaryYaml`/`mergeGlossaries` にもプロトタイプ汚染的な穴が
// あった。YAML のマッピングキーが `"__proto__"` のとき、素のオブジェクト
// リテラル（`{}`）ベースの実装では `glossary["__proto__"] = term` が
// `glossary` 自身の `[[Prototype]]` を書き換えてしまっていた（Annex B の
// `__proto__` アクセサ）。`Object.create(null)` ベースに直したことで
// これが通常の own property として扱われることを固定する。
describe("parseGlossaryYaml (prototype pollution guard)", () => {
  it("stores a term keyed \"__proto__\" as a normal own property instead of rewriting the prototype", () => {
    const glossary = parseGlossaryYaml(`
__proto__:
  name: { ja: "邪悪", en: "evil" }
  definition: { ja: "説明", en: "definition" }
`);

    // own property として引ける（プロトタイプの書き換えでは own property
    // にならないため、修正前はここが false になる）。
    expect(Object.hasOwn(glossary, "__proto__")).toBe(true);
    expect(glossary.__proto__?.name.en).toBe("evil");

    // 修正前の症状の再現: プロトタイプ自体が term に差し替わっていない
    // （通常のオブジェクトのまま Object.prototype を継承している）。
    expect(Object.getPrototypeOf(glossary)).toBe(null);

    // 無関係な未知キーの参照が term の中身を漏らさない
    // （プロトタイプ経由の継承フォールバックが起きていないことの確認）。
    expect(Object.hasOwn(glossary, "otherKey")).toBe(false);
  });

  it("returns a glossary with no prototype for empty or non-object input", () => {
    expect(Object.getPrototypeOf(parseGlossaryYaml(""))).toBe(null);
    expect(Object.getPrototypeOf(parseGlossaryYaml("- a\n- b"))).toBe(null);
  });

  it("keeps other terms in the same file intact alongside a \"__proto__\" entry", () => {
    const glossary = parseGlossaryYaml(`
__proto__:
  name: { ja: "邪悪", en: "evil" }
  definition: { ja: "説明", en: "definition" }
good:
  name: { ja: "名前", en: "Name" }
  definition: { ja: "説明", en: "Definition" }
`);
    expect(Object.hasOwn(glossary, "good")).toBe(true);
    expect(glossary.good.name.en).toBe("Name");
  });
});

describe("mergeGlossaries (prototype pollution guard)", () => {
  it("keeps a \"__proto__\"-keyed term as an own property after merging multiple parts", () => {
    const evil = parseGlossaryYaml(`
__proto__:
  name: { ja: "邪悪", en: "evil" }
  definition: { ja: "説明", en: "definition" }
`);
    const good = parseGlossaryYaml(`
good:
  name: { ja: "名前", en: "Name" }
  definition: { ja: "説明", en: "Definition" }
`);

    const merged = mergeGlossaries(evil, good);

    // マージ先自体のプロトタイプが書き換わっていない。
    expect(Object.getPrototypeOf(merged)).toBe(null);
    expect(Object.hasOwn(merged, "__proto__")).toBe(true);
    expect(merged.__proto__?.name.en).toBe("evil");
    expect(Object.hasOwn(merged, "good")).toBe(true);
    expect(merged.good.name.en).toBe("Name");
  });
});
