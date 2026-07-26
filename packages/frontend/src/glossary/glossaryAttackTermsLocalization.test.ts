// Issue #413 テスト強化: 新設6語の ja/en 文言そのものの異常系を固定する。
// スキーマ（キーの存在・layer・非空）と relatedTerms の双方向リンクは
// glossaryAttackTermsIntegrity.test.ts が見るため、ここでは「値が揃っては
// いるが中身が壊れている」パターン（訳し忘れ・和文の混入・定義文が名前の
// 使い回し・ブロックスカラーの取り違え・定義文中の用語参照切れ）だけを扱う
// （CLAUDE.md「1ファイル1責務」）。
import { describe, expect, it } from "vitest";
import { ATTACK_TERM_KEYS } from "./attackTermsFixture.js";
import { loadRealGlossary } from "./realGlossaryFixture.js";

const glossary = loadRealGlossary();

// ひらがな(3040-309f)・カタカナ(30a0-30ff)・CJK統合漢字(4e00-9fff)。
// 既存のフロント側テスト（MempoolPanel.frontRunningAnchor 等）が英語表示の
// 和文混入を見るのに使っているのと同じ範囲。
const JAPANESE = /[぀-ヿ一-鿿]/;

describe("attack term ja/en localization (Issue #413)", () => {
  it.each(ATTACK_TERM_KEYS)("%s has distinct ja and en names", (key) => {
    const { name } = glossary[key];
    // 定義文の ja/en 一致は integrity テストが見ているが、名前側は
    // 「en に和名をそのまま置いた」ケースを取り逃がしていた。
    expect(name.ja).not.toBe(name.en);
  });

  it.each(ATTACK_TERM_KEYS)("%s keeps Japanese out of its en name and definition", (key) => {
    const entry = glossary[key];
    expect(entry.name.en).not.toMatch(JAPANESE);
    expect(entry.definition.en).not.toMatch(JAPANESE);
  });

  it.each(ATTACK_TERM_KEYS)("%s actually writes its ja definition in Japanese", (key) => {
    // en の文面を ja 欄へコピーしただけ（未翻訳）の取り違えを弾く。
    expect(glossary[key].definition.ja).toMatch(JAPANESE);
  });

  it.each(ATTACK_TERM_KEYS)("%s does not reuse the term name as its definition", (key) => {
    const entry = glossary[key];
    expect(entry.definition.ja).not.toBe(entry.name.ja);
    expect(entry.definition.en).not.toBe(entry.name.en);
  });

  it.each(ATTACK_TERM_KEYS)("%s stores each definition as a single folded paragraph", (key) => {
    const entry = glossary[key];
    // 既存6語はいずれも YAML の折りたたみブロックスカラー（`>-`）で書かれて
    // おり、改行は空白に畳まれる。`|`（リテラル）に取り違えると改行がそのまま
    // 残り、6行でクランプされる用語ポップオーバー
    // （styles.css `.glossary-popover__definition`）の見え方が崩れる。
    expect(entry.definition.ja).not.toContain("\n");
    expect(entry.definition.en).not.toContain("\n");
    // parse.ts の toLocalized が trim するため前後空白は残らないが、折りたたみ
    // の結果として語間に二重空白が生まれていないことも合わせて見る。
    expect(entry.definition.ja).not.toContain("  ");
    expect(entry.definition.en).not.toContain("  ");
  });
});

describe("attack term definition prose references (Issue #413)", () => {
  it.each(ATTACK_TERM_KEYS)(
    "%s only backquotes existing term keys in its definitions",
    (key) => {
      // 新設6語の定義文は他の用語をバッククォート（例: `fork`・`reorg`）で
      // 参照している。参照先の綴りが違う・後で用語キーを改名した場合、
      // relatedTerms 側の dangling チェック（glossaryRelatedTermsIntegrity）
      // では検出できず、読み手にだけ壊れた参照が見える。
      //
      // repo 全体の用語データも現時点では同じ不変条件を満たしているが、将来
      // `eth_getLogs` のようなコード断片をバッククォートで書く余地を残すため、
      // 強制するのは Issue #413 の6語に限る。
      const entry = glossary[key];
      const referenced = new Set<string>();
      for (const text of [entry.definition.ja, entry.definition.en]) {
        for (const match of text.matchAll(/`([^`]+)`/g)) {
          referenced.add(match[1]);
        }
      }
      const dangling = [...referenced].filter(
        (ref) => !Object.hasOwn(glossary, ref),
      );
      expect(dangling).toEqual([]);
    },
  );

  it("does not backquote the term itself (pointless self reference)", () => {
    for (const key of ATTACK_TERM_KEYS) {
      const entry = glossary[key];
      expect(entry.definition.ja).not.toContain(`\`${key}\``);
      expect(entry.definition.en).not.toContain(`\`${key}\``);
    }
  });
});
