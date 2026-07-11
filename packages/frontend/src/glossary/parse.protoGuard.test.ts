import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeGlossaries, parseGlossaryYaml } from "./parse.js";

// jsdom 環境では import.meta.url が file スキームでないため、cwd から
// 上方向にリポジトリルートの glossary/ を探索する（parse.test.ts と同じ）。
function findGlossaryFile(relativePath: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`${relativePath} not found from cwd`);
}

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

  it("lets a later part override a \"__proto__\"-keyed term as a normal own property", () => {
    // `__proto__` キーの用語も通常キーと同じ上書きセマンティクスに従う
    // （`Object.create(null)` にしたことで `Object.assign` の書き込みが
    // アクセサ経由にならず、後勝ちの own property 上書きになる）ことを固定。
    const older = parseGlossaryYaml(`
__proto__:
  name: { ja: "旧", en: "old" }
  definition: { ja: "説明", en: "definition" }
`);
    const newer = parseGlossaryYaml(`
__proto__:
  name: { ja: "新", en: "new" }
  definition: { ja: "説明", en: "definition" }
`);
    const merged = mergeGlossaries(older, newer);
    expect(Object.getPrototypeOf(merged)).toBe(null);
    expect(merged.__proto__?.name.en).toBe("new");
    // 上書きされても own property は1つだけで、列挙にも1回だけ現れる。
    expect(
      Object.keys(merged).filter((k) => k === "__proto__"),
    ).toEqual(["__proto__"]);
  });
});

describe("mergeGlossaries (Object.create(null) refactor does not break normal merging)", () => {
  // Issue #264 の書き込み側修正（`Object.assign({}, ...)` を
  // `Object.assign(Object.create(null), ...)` に変更）が、`__proto__` を
  // 含まない通常の用語のマージ動作を壊していないことを固定する。
  const partA = parseGlossaryYaml(`
alpha:
  name: { ja: "アルファ", en: "Alpha" }
  definition: { ja: "a", en: "a" }
`);
  const partB = parseGlossaryYaml(`
beta:
  name: { ja: "ベータ", en: "Beta" }
  definition: { ja: "b", en: "b" }
`);
  const partC = parseGlossaryYaml(`
alpha:
  name: { ja: "アルファ改", en: "Alpha2" }
  definition: { ja: "a2", en: "a2" }
gamma:
  name: { ja: "ガンマ", en: "Gamma" }
  definition: { ja: "g", en: "g" }
`);

  it("preserves entries from earlier parts not present in later parts", () => {
    const merged = mergeGlossaries(partA, partB, partC);
    expect(merged.beta.name.en).toBe("Beta");
    expect(merged.gamma.name.en).toBe("Gamma");
  });

  it("applies later parts as the winner across three or more parts", () => {
    const merged = mergeGlossaries(partA, partB, partC);
    // alpha は partA と partC の双方に存在し、最後の partC が勝つ。
    expect(merged.alpha.name.en).toBe("Alpha2");
    expect(Object.keys(merged).sort()).toEqual(["alpha", "beta", "gamma"]);
  });

  it("treats an empty glossary among the parts as a no-op (does not wipe others)", () => {
    const empty = parseGlossaryYaml("");
    const merged = mergeGlossaries(partA, empty, partB);
    expect(Object.keys(merged).sort()).toEqual(["alpha", "beta"]);
  });

  it("returns a shallow copy so mutating the result does not affect source parts", () => {
    const merged = mergeGlossaries(partA, partB);
    delete (merged as Record<string, unknown>).alpha;
    // 元の part は影響を受けない（Object.assign はトップレベルを複製する）。
    expect(Object.hasOwn(partA, "alpha")).toBe(true);
  });

  it("keeps a single part's entries intact when merging just one part", () => {
    const merged = mergeGlossaries(partA);
    expect(Object.getPrototypeOf(merged)).toBe(null);
    expect(merged.alpha.name.en).toBe("Alpha");
  });
});

describe("Object.create(null) glossary interop (refactor does not break downstream usage)", () => {
  // Issue #264 で glossary を `Object.create(null)` ベースにしたことで
  // `toString`/`hasOwnProperty` などの継承メソッド自体が無くなる。後続の
  // コード（`data.ts` の実データ経路、`Object.entries`/`for...in`/
  // `JSON.stringify`/スプレッド）がこの「プロトタイプ無し」オブジェクトで
  // 壊れないことを、実データをマージした glossary で固定する。
  const aInfraPath = findGlossaryFile("glossary/ethereum/terms/a-infra.yaml");
  const bNetworkPath = findGlossaryFile(
    "glossary/ethereum/terms/b-network.yaml",
  );

  function realMerged() {
    return mergeGlossaries(
      parseGlossaryYaml(readFileSync(aInfraPath, "utf8")),
      parseGlossaryYaml(readFileSync(bNetworkPath, "utf8")),
    );
  }

  it("has a null prototype but is still iterable via Object.entries/keys/values", () => {
    const merged = realMerged();
    expect(Object.getPrototypeOf(merged)).toBe(null);
    const entries = Object.entries(merged);
    expect(entries.length).toBeGreaterThan(0);
    expect(Object.keys(merged).length).toBe(entries.length);
    expect(Object.values(merged).length).toBe(entries.length);
  });

  it("is enumerable with for...in without leaking inherited keys", () => {
    const merged = realMerged();
    const keys: string[] = [];
    for (const key in merged) keys.push(key);
    // `Object.create(null)` なので継承キーが混入しない。for...in の結果は
    // own keys と完全一致する。
    expect(keys.sort()).toEqual(Object.keys(merged).sort());
    expect(keys).toContain("container");
  });

  it("serializes with JSON.stringify without needing a toString on the prototype", () => {
    const merged = realMerged();
    // `Object.create(null)` は toString を継承しないが、JSON.stringify は
    // それを必要としないため問題なく直列化できる。
    const json = JSON.stringify(merged);
    const round = JSON.parse(json) as Record<string, { name: { en: string } }>;
    expect(round.container.name.en).toBe(
      merged.container.name.en,
    );
  });

  it("survives an object spread that copies own enumerable properties", () => {
    const merged = realMerged();
    const spread = { ...merged };
    expect(Object.keys(spread).sort()).toEqual(Object.keys(merged).sort());
    expect(spread.container.name.en).toBe(merged.container.name.en);
  });
});
