// Issue #413 テスト強化: 新設6語が用語集パネルから実際に「引ける」ことを
// 固定する。アンカー（既存可視化5箇所）からの導線はフロント側のテストが
// 見ているが、アンカーを踏まずにパネルを開いて探す経路（検索窓・層グループ
// 一覧。UX設計 §3.3/§3.6）は誰も見ていなかった。
//
// glossarySearch.ts 自体のロジックは glossarySearch.test.ts がモック用語で
// 網羅しているため、ここでは実データの6語がその経路に乗ることだけを扱う
// （CLAUDE.md「1ファイル1責務」）。
import { describe, expect, it } from "vitest";
import { ATTACK_TERM_KEYS } from "./attackTermsFixture.js";
import {
  filterGlossaryTerms,
  glossaryToOrderedTerms,
  groupGlossaryTermsByLayer,
  matchesGlossaryQuery,
} from "./glossarySearch.js";
import { loadRealGlossary } from "./realGlossaryFixture.js";

const glossary = loadRealGlossary();
const orderedTerms = glossaryToOrderedTerms(glossary);

describe("attack terms are reachable from the glossary panel list (Issue #413)", () => {
  it("includes all six new terms in the ordered term list", () => {
    const keys = orderedTerms.map((term) => term.key);
    for (const key of ATTACK_TERM_KEYS) {
      expect(keys).toContain(key);
    }
  });

  it.each(ATTACK_TERM_KEYS)("%s lands in a rendered layer group", (key) => {
    const groups = groupGlossaryTermsByLayer(orderedTerms);
    const owning = groups.filter((group) =>
      group.terms.some((term) => term.key === key),
    );
    // 1グループにだけ現れる（グループ化の取りこぼし・二重計上がない）。
    expect(owning).toHaveLength(1);
    expect(owning[0].layer).not.toBe("other");
  });
});

describe("attack terms are reachable by search query (Issue #413)", () => {
  it.each(ATTACK_TERM_KEYS)("%s matches a query of its own ja name", (key) => {
    const term = glossary[key];
    expect(matchesGlossaryQuery(term, term.name.ja, "ja")).toBe(true);
  });

  it.each(ATTACK_TERM_KEYS)("%s matches a query of its own en name", (key) => {
    const term = glossary[key];
    expect(matchesGlossaryQuery(term, term.name.en, "en")).toBe(true);
  });

  it.each(ATTACK_TERM_KEYS)("%s matches its raw key regardless of case", (key) => {
    const term = glossary[key];
    expect(matchesGlossaryQuery(term, key.toUpperCase(), "ja")).toBe(true);
    expect(matchesGlossaryQuery(term, key.toLowerCase(), "en")).toBe(true);
  });

  it.each(ATTACK_TERM_KEYS)("%s matches its en name even while reading in ja", (key) => {
    // 検索対象は用語名の ja/en 両方（glossarySearch.ts `matchesGlossaryQuery`）。
    // 日本語表示のまま "eclipse" のような英語綴りで探せることを固定する。
    const term = glossary[key];
    expect(matchesGlossaryQuery(term, term.name.en.toLowerCase(), "ja")).toBe(true);
  });

  it("finds the three sandbox attack terms with an English 'attack' query", () => {
    const hits = filterGlossaryTerms(orderedTerms, "attack", "en").map((t) => t.key);
    expect(hits).toEqual(
      expect.arrayContaining(["fiftyOnePercentAttack", "longRangeAttack", "eclipseAttack"]),
    );
  });

  it("keeps every new term visible for an empty query (whitespace only)", () => {
    // 空クエリ・空白のみのクエリは全件表示（UX設計 §3.6）。フィルタの
    // 境界値として、新設語が「検索していない状態」で消えないことを固定する。
    const hits = filterGlossaryTerms(orderedTerms, "   ", "ja").map((t) => t.key);
    for (const key of ATTACK_TERM_KEYS) {
      expect(hits).toContain(key);
    }
  });

  it("returns no new term for a query that matches none of them", () => {
    const hits = filterGlossaryTerms(orderedTerms, "zzz-no-such-term", "ja");
    expect(hits).toEqual([]);
  });
});
