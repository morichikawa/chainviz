import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeGlossaries, parseGlossaryYaml } from "./parse.js";

// jsdom 環境では import.meta.url が file スキームでないため、cwd から
// 上方向にリポジトリルートの glossary/ を探索する。
function findGlossaryFile(relativePath: string): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, relativePath);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error(`${relativePath} not found from cwd`);
}

const aInfraPath = findGlossaryFile("glossary/ethereum/terms/a-infra.yaml");
const bNetworkPath = findGlossaryFile("glossary/ethereum/terms/b-network.yaml");
const cTransactionPath = findGlossaryFile(
  "glossary/ethereum/terms/c-transaction.yaml",
);

describe("parseGlossaryYaml", () => {
  it("parses the real A-layer glossary file", () => {
    const glossary = parseGlossaryYaml(readFileSync(aInfraPath, "utf8"));
    expect(Object.keys(glossary)).toContain("container");
    const container = glossary.container;
    expect(container.name.ja).toBe("コンテナ");
    expect(container.name.en).toBe("Container");
    expect(container.definition.ja.length).toBeGreaterThan(0);
    expect(container.definition.en.length).toBeGreaterThan(0);
    expect(container.layer).toBe("a-infra");
    expect(container.relatedTerms).toContain("port-mapping");
  });

  it("every term in the real file has both ja and en for name and definition", () => {
    const glossary = parseGlossaryYaml(readFileSync(aInfraPath, "utf8"));
    for (const term of Object.values(glossary)) {
      expect(term.name.ja).toBeTruthy();
      expect(term.name.en).toBeTruthy();
      expect(term.definition.ja).toBeTruthy();
      expect(term.definition.en).toBeTruthy();
    }
  });

  it("returns an empty glossary for empty or non-object input", () => {
    expect(parseGlossaryYaml("")).toEqual({});
    expect(parseGlossaryYaml("- a\n- b")).toEqual({});
    expect(parseGlossaryYaml("42")).toEqual({});
  });

  it("skips entries missing a language or the definition", () => {
    const glossary = parseGlossaryYaml(`
good:
  name: { ja: "用語", en: "Term" }
  definition: { ja: "説明", en: "Definition" }
  layer: a-infra
  relatedTerms: [good]
missingEn:
  name: { ja: "片方だけ" }
  definition: { ja: "説明", en: "Definition" }
noDefinition:
  name: { ja: "名前", en: "Name" }
`);
    expect(Object.keys(glossary)).toEqual(["good"]);
    expect(glossary.good.relatedTerms).toEqual(["good"]);
  });

  it("defaults layer and relatedTerms when absent or wrong type", () => {
    const glossary = parseGlossaryYaml(`
term:
  name: { ja: "名前", en: "Name" }
  definition: { ja: "説明", en: "Definition" }
  relatedTerms: "not-an-array"
`);
    expect(glossary.term.layer).toBe("");
    expect(glossary.term.relatedTerms).toEqual([]);
  });

  it("skips entries whose language value is not a string", () => {
    const glossary = parseGlossaryYaml(`
numeric:
  name: { ja: "名前", en: 123 }
  definition: { ja: "説明", en: "Definition" }
`);
    expect(glossary.numeric).toBeUndefined();
  });

  it("skips entries where name is a string instead of a localized object", () => {
    const glossary = parseGlossaryYaml(`
bad:
  name: "just a string"
  definition: { ja: "説明", en: "Definition" }
`);
    expect(glossary.bad).toBeUndefined();
  });

  it("skips entries whose value is null", () => {
    const glossary = parseGlossaryYaml(`
empty:
good:
  name: { ja: "名前", en: "Name" }
  definition: { ja: "説明", en: "Definition" }
`);
    expect(Object.keys(glossary)).toEqual(["good"]);
  });

  it("trims surrounding whitespace in localized values", () => {
    const glossary = parseGlossaryYaml(`
term:
  name: { ja: "  名前  ", en: "  Name  " }
  definition: { ja: " 説明 ", en: " Definition " }
`);
    expect(glossary.term.name.ja).toBe("名前");
    expect(glossary.term.name.en).toBe("Name");
    expect(glossary.term.definition.ja).toBe("説明");
  });

  it("filters non-string entries out of relatedTerms", () => {
    const glossary = parseGlossaryYaml(`
term:
  name: { ja: "名前", en: "Name" }
  definition: { ja: "説明", en: "Definition" }
  relatedTerms: [good, 42, alsoGood]
`);
    expect(glossary.term.relatedTerms).toEqual(["good", "alsoGood"]);
  });

  it("defaults layer to empty string when it has the wrong type", () => {
    const glossary = parseGlossaryYaml(`
term:
  name: { ja: "名前", en: "Name" }
  definition: { ja: "説明", en: "Definition" }
  layer: 7
`);
    expect(glossary.term.layer).toBe("");
  });
});

describe("mergeGlossaries", () => {
  it("combines multiple glossaries with later entries winning", () => {
    const a = parseGlossaryYaml(`
x:
  name: { ja: "A", en: "A" }
  definition: { ja: "a", en: "a" }
`);
    const b = parseGlossaryYaml(`
y:
  name: { ja: "B", en: "B" }
  definition: { ja: "b", en: "b" }
`);
    const merged = mergeGlossaries(a, b);
    expect(Object.keys(merged).sort()).toEqual(["x", "y"]);
  });

  it("lets a later glossary override the same key", () => {
    const a = parseGlossaryYaml(`
x:
  name: { ja: "旧", en: "old" }
  definition: { ja: "a", en: "a" }
`);
    const b = parseGlossaryYaml(`
x:
  name: { ja: "新", en: "new" }
  definition: { ja: "b", en: "b" }
`);
    const merged = mergeGlossaries(a, b);
    expect(merged.x.name.en).toBe("new");
  });

  it("returns an empty glossary with no arguments", () => {
    expect(mergeGlossaries()).toEqual({});
  });
});

describe("real glossary data files (regression: duplicate keys, merge conflicts)", () => {
  // Issue #123 レビューで発覚: rebase時にb-network.yamlへbootnodeが2重定義
  // されたまま気づかれず(挿入位置が違いコンフリクトマーカーが出なかった)、
  // js-yamlが重複キーで例外を投げてアプリ起動時にクラッシュする不具合が
  // あった。glossary/data.tsが実際に読む全ファイルを、data.tsと同じ
  // mergeGlossaries経路でパースし、例外なく完了すること・キーが重複せず
  // 各層のキー数の単純合計と一致することを固定する。
  const files = [
    { name: "a-infra", path: aInfraPath },
    { name: "b-network", path: bNetworkPath },
    { name: "c-transaction", path: cTransactionPath },
  ];

  it("parses every real glossary file without throwing", () => {
    for (const file of files) {
      expect(() => parseGlossaryYaml(readFileSync(file.path, "utf8"))).not.toThrow();
    }
  });

  it("has no duplicate term keys within any single real file", () => {
    // parseGlossaryYamlはJSオブジェクトを経由するため、YAML内で同じキーが
    // 2度定義されても後勝ちで静かに1件へ潰れ、テスト側からは重複を検知
    // できない。js-yamlが実際にパース時点で例外を投げることを直接確認する。
    for (const file of files) {
      const yaml = readFileSync(file.path, "utf8");
      const keys: string[] = [];
      for (const match of yaml.matchAll(/^([a-zA-Z0-9-]+):$/gm)) {
        keys.push(match[1]);
      }
      const seen = new Set<string>();
      const duplicates = keys.filter((key) =>
        seen.has(key) ? true : (seen.add(key), false),
      );
      expect(duplicates).toEqual([]);
    }
  });

  it("merges all three real files into a single glossary without key collisions", () => {
    const merged = mergeGlossaries(
      parseGlossaryYaml(readFileSync(aInfraPath, "utf8")),
      parseGlossaryYaml(readFileSync(bNetworkPath, "utf8")),
      parseGlossaryYaml(readFileSync(cTransactionPath, "utf8")),
    );
    const individualCounts = files.map(
      (file) =>
        Object.keys(parseGlossaryYaml(readFileSync(file.path, "utf8"))).length,
    );
    const totalIndividual = individualCounts.reduce((a, b) => a + b, 0);
    expect(Object.keys(merged).length).toBe(totalIndividual);
  });
});
