import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { mergeGlossaries, parseGlossaryYaml } from "./parse.js";

// jsdom 環境では import.meta.url が file スキームでないため、cwd から
// 上方向にリポジトリルートの glossary/ を探索する。
function findGlossaryFile(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, "glossary/ethereum/terms/a-infra.yaml");
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new Error("a-infra.yaml not found from cwd");
}

const aInfraPath = findGlossaryFile();

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
