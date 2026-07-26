// Issue #413 テスト強化: 新設6語が「どのファイルに定義され、用語集パネルの
// どの層グループへ落ちるか」を固定する。integrity テストはマージ後の
// `layer` 文字列だけを見ているため、以下の穴が残っていた。
//
// - `layer: b-network` の語が別ファイル（c-transaction.yaml 等）に紛れ込んで
//   いても気付けない（ファイル分割 = 層の分割という前提が崩れる）
// - `layer` の綴りを崩した場合（例: "network"）、用語集パネルは A〜D 層の
//   どのグループにも入れず「その他」へ落とす（glossarySearch.ts
//   `resolveGlossaryLayerGroupKey`）。文字列比較だけでは、この「静かに
//   その他へ落ちる」結果を検出できない
// - 同じキーを2ファイルに重複定義すると `mergeGlossaries`（Object.assign）が
//   後勝ちで黙って上書きする
import { describe, expect, it } from "vitest";
import {
  ATTACK_TERM_KEYS,
  EXPECTED_ATTACK_TERM_PLACEMENT,
} from "./attackTermsFixture.js";
import { resolveGlossaryLayerGroupKey } from "./glossarySearch.js";
import {
  GLOSSARY_FILE_NAMES,
  loadGlossaryFiles,
  loadRealGlossary,
} from "./realGlossaryFixture.js";

const perFile = loadGlossaryFiles();
const glossary = loadRealGlossary();

describe("attack term placement across glossary files (Issue #413)", () => {
  it.each(ATTACK_TERM_KEYS)("%s is defined in the file matching its layer", (key) => {
    const expected = EXPECTED_ATTACK_TERM_PLACEMENT[key];
    expect(Object.hasOwn(perFile[expected.file], key)).toBe(true);
    expect(perFile[expected.file][key].layer).toBe(expected.layer);
  });

  it.each(ATTACK_TERM_KEYS)("%s is defined in exactly one file", (key) => {
    const files = GLOSSARY_FILE_NAMES.filter((name) =>
      Object.hasOwn(perFile[name], key),
    );
    expect(files).toEqual([EXPECTED_ATTACK_TERM_PLACEMENT[key].file]);
  });

  it("merges the four files without any key collision (nothing silently overwritten)", () => {
    // 重複キーがあると Object.assign の後勝ちでマージ後の件数が減る。
    const perFileTotal = GLOSSARY_FILE_NAMES.reduce(
      (sum, name) => sum + Object.keys(perFile[name]).length,
      0,
    );
    expect(Object.keys(glossary).length).toBe(perFileTotal);
  });
});

describe("attack term layer grouping in the glossary panel (Issue #413)", () => {
  it.each(ATTACK_TERM_KEYS)("%s resolves to an A-D layer group, never 'other'", (key) => {
    const groupKey = resolveGlossaryLayerGroupKey(glossary[key].layer);
    const expectedGroupKey = EXPECTED_ATTACK_TERM_PLACEMENT[key].layer.charAt(0);
    expect(groupKey).toBe(expectedGroupKey);
    expect(groupKey).not.toBe("other");
  });
});
