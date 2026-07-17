import { describe, expect, it } from "vitest";
import type { Glossary, GlossaryTerm } from "./types.js";
import {
  filterGlossaryTerms,
  glossaryToOrderedTerms,
  groupGlossaryTermsByLayer,
  matchesGlossaryQuery,
  resolveGlossaryLayerGroupKey,
} from "./glossarySearch.js";

function term(overrides: Partial<GlossaryTerm> & { key: string }): GlossaryTerm {
  return {
    name: { ja: "", en: "" },
    definition: { ja: "", en: "" },
    layer: "a-infra",
    relatedTerms: [],
    ...overrides,
  };
}

describe("resolveGlossaryLayerGroupKey", () => {
  it("maps a/b/c/d-prefixed layer values to their VisualizationLayer", () => {
    expect(resolveGlossaryLayerGroupKey("a-infra")).toBe("a");
    expect(resolveGlossaryLayerGroupKey("b-network")).toBe("b");
    expect(resolveGlossaryLayerGroupKey("c-transaction")).toBe("c");
    expect(resolveGlossaryLayerGroupKey("d-internal")).toBe("d");
  });

  it("is case-insensitive on the prefix", () => {
    expect(resolveGlossaryLayerGroupKey("A-INFRA")).toBe("a");
  });

  it("falls back to 'other' for an unknown prefix or empty string (parse.ts leaves `layer` empty on missing YAML field)", () => {
    expect(resolveGlossaryLayerGroupKey("")).toBe("other");
    expect(resolveGlossaryLayerGroupKey("z-unknown")).toBe("other");
  });

  it("maps a bare single-character layer value ('a' without suffix) to its VisualizationLayer", () => {
    expect(resolveGlossaryLayerGroupKey("a")).toBe("a");
    expect(resolveGlossaryLayerGroupKey("d")).toBe("d");
  });

  it("treats a leading-whitespace layer value as 'other' (only the first char is inspected)", () => {
    // charAt(0) が空白なので a-d に一致しない。想定外データでも表示を落とさず
    // 「その他」に寄せる（UX設計 §3.3 の耐性）。
    expect(resolveGlossaryLayerGroupKey(" a-infra")).toBe("other");
  });
});

describe("matchesGlossaryQuery", () => {
  const t = term({
    key: "container",
    name: { ja: "コンテナ", en: "Container" },
    definition: { ja: "隔離された実行単位", en: "An isolated runtime unit" },
  });

  it("matches an empty query unconditionally (shows everything by default)", () => {
    expect(matchesGlossaryQuery(t, "", "ja")).toBe(true);
    expect(matchesGlossaryQuery(t, "   ", "ja")).toBe(true);
  });

  it("matches a partial hit on the ja name regardless of the current language", () => {
    expect(matchesGlossaryQuery(t, "テナ", "en")).toBe(true);
  });

  it("matches a partial hit on the en name regardless of the current language", () => {
    expect(matchesGlossaryQuery(t, "contain", "ja")).toBe(true);
  });

  it("matches a partial hit on the key", () => {
    expect(matchesGlossaryQuery(t, "tain", "ja")).toBe(true);
  });

  it("matches only the current language's definition, not the other language's", () => {
    expect(matchesGlossaryQuery(t, "隔離", "ja")).toBe(true);
    expect(matchesGlossaryQuery(t, "isolated", "ja")).toBe(false);
    expect(matchesGlossaryQuery(t, "isolated", "en")).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(matchesGlossaryQuery(t, "CONTAIN", "ja")).toBe(true);
  });

  it("is case-insensitive on the key too (keys are lowercase, query may not be)", () => {
    expect(matchesGlossaryQuery(t, "CONTAINER", "ja")).toBe(true);
  });

  it("trims leading/trailing whitespace of the query before matching", () => {
    expect(matchesGlossaryQuery(t, "  contain  ", "ja")).toBe(true);
    // 全角ではなく半角スペースのみを trim する（String.prototype.trim の仕様）。
    expect(matchesGlossaryQuery(t, "\tcontainer\n", "ja")).toBe(true);
  });

  it("does not collapse whitespace inside the query (internal spaces are literal)", () => {
    // "contain er" は "container" の連続部分文字列ではないので一致しない
    // （空白正規化・トークン分割はしない仕様。UX設計 §3.6）。
    expect(matchesGlossaryQuery(t, "contain er", "ja")).toBe(false);
  });

  it("matches a single-character query (no minimum length)", () => {
    expect(matchesGlossaryQuery(t, "c", "ja")).toBe(true);
  });

  it("matches a query equal to the whole field (upper boundary of partial match)", () => {
    expect(matchesGlossaryQuery(t, "container", "ja")).toBe(true);
    expect(matchesGlossaryQuery(t, "コンテナ", "ja")).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(matchesGlossaryQuery(t, "no-such-substring", "ja")).toBe(false);
  });
});

describe("filterGlossaryTerms", () => {
  it("preserves input order among the matches", () => {
    const a = term({ key: "a", name: { ja: "あ", en: "a-term" } });
    const b = term({ key: "b", name: { ja: "い", en: "b-term" } });
    const c = term({ key: "c", name: { ja: "う", en: "c-term" } });
    expect(filterGlossaryTerms([a, b, c], "term", "en").map((x) => x.key)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns an empty array when nothing matches", () => {
    const a = term({ key: "a", name: { ja: "あ", en: "a-term" } });
    expect(filterGlossaryTerms([a], "no-match", "en")).toEqual([]);
  });
});

describe("groupGlossaryTermsByLayer", () => {
  it("groups terms in fixed a -> b -> c -> d -> other order, omitting empty groups", () => {
    const a = term({ key: "a", layer: "a-infra" });
    const c = term({ key: "c", layer: "c-transaction" });
    const other = term({ key: "z", layer: "unknown-layer" });
    // 入力順は a -> other -> c だが、出力のグループ順は固定順(a,c,other)になる。
    const groups = groupGlossaryTermsByLayer([a, other, c]);
    expect(groups.map((g) => g.layer)).toEqual(["a", "c", "other"]);
    // b/d は該当する用語が無いので出てこない。
  });

  it("preserves the original array order within each group (YAML/学習順の維持)", () => {
    const first = term({ key: "first", layer: "a-infra" });
    const second = term({ key: "second", layer: "a-infra" });
    const third = term({ key: "third", layer: "a-infra" });
    const groups = groupGlossaryTermsByLayer([first, second, third]);
    expect(groups).toHaveLength(1);
    expect(groups[0].terms.map((t) => t.key)).toEqual(["first", "second", "third"]);
  });

  it("returns an empty array for an empty input", () => {
    expect(groupGlossaryTermsByLayer([])).toEqual([]);
  });

  it("emits all present groups in fixed a -> b -> c -> d -> other order regardless of input order", () => {
    const d = term({ key: "d", layer: "d-internal" });
    const other = term({ key: "z", layer: "unknown" });
    const b = term({ key: "b", layer: "b-network" });
    const a = term({ key: "a", layer: "a-infra" });
    const c = term({ key: "c", layer: "c-transaction" });
    const groups = groupGlossaryTermsByLayer([d, other, b, a, c]);
    expect(groups.map((g) => g.layer)).toEqual(["a", "b", "c", "d", "other"]);
  });

  it("keeps input order within a group even when same-layer terms are interleaved with others", () => {
    // a1 -> b1 -> a2 という入力でも、a グループの中身は [a1, a2] の入力順を保つ
    // （Map バケットへの push 順を維持する実装の確認）。
    const a1 = term({ key: "a1", layer: "a-infra" });
    const b1 = term({ key: "b1", layer: "b-network" });
    const a2 = term({ key: "a2", layer: "a-infra" });
    const groups = groupGlossaryTermsByLayer([a1, b1, a2]);
    const groupA = groups.find((g) => g.layer === "a");
    expect(groupA?.terms.map((x) => x.key)).toEqual(["a1", "a2"]);
  });
});

describe("glossaryToOrderedTerms", () => {
  it("preserves insertion order (YAML declaration order) as an array", () => {
    const glossary: Glossary = Object.create(null) as Glossary;
    glossary.first = term({ key: "first" });
    glossary.second = term({ key: "second" });
    glossary.third = term({ key: "third" });
    expect(glossaryToOrderedTerms(glossary).map((t) => t.key)).toEqual([
      "first",
      "second",
      "third",
    ]);
  });

  it("returns an empty array for an empty glossary", () => {
    expect(glossaryToOrderedTerms(Object.create(null) as Glossary)).toEqual([]);
  });
});
