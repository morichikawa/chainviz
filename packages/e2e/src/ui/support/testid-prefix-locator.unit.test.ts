// `support/testid-prefix-locator.ts` のユニットテストと、UI 層 spec 全体を
// 実走査する構造整合テスト（Issue #428 の再発防止）。
//
// Issue #428 では「表示中ブロックの hash を prev ボタンの data-testid から
// 読み取る」ヘルパーが `[data-testid^="block-detail-prev-"]` の前方一致だけで
// 要素を特定しており、prev が disabled のときに描画される理由文
// `<p data-testid="block-detail-prev-reason">` にも同時にマッチして strict mode
// 違反になった。同型のヘルパーが2つの spec にあり、片方は「prev が enabled の
// 状態でしか呼ばない」ためたまたま露見していなかった。
//
// UI 層 E2E は実 Docker を要するため pre-push では走らない。そこで、同じ形の
// 衝突が別の接頭辞・別の spec で新たに生まれた場合に `pnpm test`（Docker 非依存）
// で検知できるようにしておく。

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractPrefixLocators,
  extractStaticTestIds,
  findAmbiguousPrefixLocators,
  stripComments,
} from "./testid-prefix-locator.js";

const here = dirname(fileURLToPath(import.meta.url)); // .../packages/e2e/src/ui/support
const uiDir = resolve(here, ".."); // .../packages/e2e/src/ui
const frontendSrcDir = resolve(here, "../../../../frontend/src");

/** Issue #428 で実際に落ちた（修正前の）ヘルパーのロケータ。 */
const BUGGY_LOCATOR = '.locator(\'[data-testid^="block-detail-prev-"]\')';
/** 修正後のロケータ。 */
const FIXED_LOCATOR = '.locator(\'button[data-testid^="block-detail-prev-"]\')';
/** 衝突相手（prev が disabled のときだけ描画される理由文）。 */
const REASON_MARKUP =
  '<p className="block-detail-view__nav-reason" data-testid="block-detail-prev-reason">';
/** 動的採番されるボタン側の markup。 */
const BUTTON_MARKUP = "<button data-testid={`block-detail-prev-${block.hash}`}>";

describe("stripComments", () => {
  it("行コメント・ブロックコメントを空白にし、長さと改行を保つ", () => {
    const source = "const a = 1; // note\n/* block */ const b = 2;\n";
    const stripped = stripComments(source);
    expect(stripped).toHaveLength(source.length);
    expect(stripped.split("\n")).toHaveLength(source.split("\n").length);
    expect(stripped).toContain("const a = 1;");
    expect(stripped).toContain("const b = 2;");
    expect(stripped).not.toContain("note");
    expect(stripped).not.toContain("block");
  });

  it("文字列リテラル中の // は削らない（URL を巻き込まない）", () => {
    const source = 'const url = "http://127.0.0.1:5275/"; // 実際のコメント';
    const stripped = stripComments(source);
    expect(stripped).toContain('"http://127.0.0.1:5275/"');
    expect(stripped).not.toContain("実際のコメント");
  });

  it("同じ行でURLの後ろに書かれたロケータを取りこぼさない", () => {
    // 素朴に「// 以降を削る」実装だと、この行のロケータごと消えてしまう。
    const source =
      'await page.goto("http://127.0.0.1:5275/"); const s = \'button[data-testid^="block-detail-prev-"]\';';
    expect(extractPrefixLocators(source)).toEqual([
      { prefix: "block-detail-prev-", tag: "button" },
    ]);
  });

  it("文字列リテラル中の /* もブロックコメント開始とみなさない", () => {
    const source = 'const s = "/*"; const t = "keep";';
    expect(stripComments(source)).toBe(source);
  });

  it("エスケープされた引用符で文字列の終端を誤認しない", () => {
    const source = 'const s = "he said \\"hi\\" // not a comment"; // real';
    const stripped = stripComments(source);
    expect(stripped).toContain("not a comment");
    expect(stripped).not.toContain("real");
  });

  it("テンプレートリテラル中の // は削らない", () => {
    const source = "const s = `http://x`; // real";
    const stripped = stripComments(source);
    expect(stripped).toContain("http://x");
    expect(stripped).not.toContain("real");
  });

  it("コメントの中に書かれた前方一致ロケータは検査対象にしない", () => {
    // アンチパターンを注意書きとしてコメントに残せるようにするための挙動。
    const source = `// 悪い例: '[data-testid^="block-detail-prev-"]' は理由文にも当たる\n${FIXED_LOCATOR}`;
    expect(extractPrefixLocators(source)).toEqual([
      { prefix: "block-detail-prev-", tag: "button" },
    ]);
  });

  it("空文字列でも壊れない", () => {
    expect(stripComments("")).toBe("");
  });
});

describe("extractPrefixLocators", () => {
  it("要素名で絞っていない前方一致ロケータを tag=null で拾う", () => {
    expect(extractPrefixLocators(BUGGY_LOCATOR)).toEqual([
      { prefix: "block-detail-prev-", tag: null },
    ]);
  });

  it("要素名で絞った前方一致ロケータはタグ名つきで拾う", () => {
    expect(extractPrefixLocators(FIXED_LOCATOR)).toEqual([
      { prefix: "block-detail-prev-", tag: "button" },
    ]);
  });

  it("属性セレクタが連結していても直前のタグ名だけを要素名として扱う", () => {
    // chain-ribbon 系で実際に使われている形。
    const source = '\'[data-testid^="chain-ribbon-tile-"][data-connected-to-previous]\'';
    expect(extractPrefixLocators(source)).toEqual([
      { prefix: "chain-ribbon-tile-", tag: null },
    ]);
  });

  it("1ファイル中の複数のロケータをすべて拾う", () => {
    const source = `${BUGGY_LOCATOR}\n${FIXED_LOCATOR}`;
    expect(extractPrefixLocators(source)).toHaveLength(2);
  });

  it("前方一致でない data-testid セレクタ・getByTestId は拾わない", () => {
    const source = `
      page.getByTestId("block-detail-prev-reason");
      page.locator('[data-testid="block-detail-view"]');
      page.locator('[data-testid*="block-detail-prev-"]');
    `;
    expect(extractPrefixLocators(source)).toEqual([]);
  });

  it("ロケータが1つも無いソースでは空配列を返す", () => {
    expect(extractPrefixLocators("")).toEqual([]);
    expect(extractPrefixLocators("const x = 1;")).toEqual([]);
  });
});

describe("extractStaticTestIds", () => {
  it("固定値の data-testid を要素のタグ名つきで拾う", () => {
    expect(extractStaticTestIds(REASON_MARKUP)).toEqual([
      { value: "block-detail-prev-reason", tag: "p" },
    ]);
  });

  it("テンプレートリテラルで動的採番される data-testid は拾わない", () => {
    expect(extractStaticTestIds(BUTTON_MARKUP)).toEqual([]);
  });

  it("空文字の data-testid は拾わない", () => {
    expect(extractStaticTestIds('<p data-testid="">')).toEqual([]);
  });

  it("直前にタグが無い（判別できない）場合もタグ名を空文字にして拾う", () => {
    expect(extractStaticTestIds('data-testid="orphan"')).toEqual([
      { value: "orphan", tag: "" },
    ]);
  });
});

describe("findAmbiguousPrefixLocators", () => {
  const reasonTestId = extractStaticTestIds(REASON_MARKUP);

  it("Issue #428 の修正前のロケータを衝突として検知する", () => {
    const found = findAmbiguousPrefixLocators(
      extractPrefixLocators(BUGGY_LOCATOR),
      reasonTestId,
    );
    expect(found).toEqual([
      {
        prefix: "block-detail-prev-",
        tag: null,
        collidingTestIds: ["block-detail-prev-reason"],
      },
    ]);
  });

  it("要素名で絞った修正後のロケータは衝突としない", () => {
    const found = findAmbiguousPrefixLocators(
      extractPrefixLocators(FIXED_LOCATOR),
      reasonTestId,
    );
    expect(found).toEqual([]);
  });

  it("要素名で絞っていても固定 testid が同じタグに付いていれば衝突とみなす", () => {
    const staticOnButton = extractStaticTestIds(
      '<button data-testid="block-detail-prev-reason">',
    );
    const found = findAmbiguousPrefixLocators(
      extractPrefixLocators(FIXED_LOCATOR),
      staticOnButton,
    );
    expect(found[0]?.collidingTestIds).toEqual(["block-detail-prev-reason"]);
  });

  it("接頭辞を共有する固定 testid が無ければ衝突としない", () => {
    const found = findAmbiguousPrefixLocators(
      extractPrefixLocators('\'[data-testid^="chain-ribbon-tile-"]\''),
      reasonTestId,
    );
    expect(found).toEqual([]);
  });

  it("同じ接頭辞に複数の固定 testid が衝突する場合は重複なく列挙する", () => {
    const staticIds = extractStaticTestIds(
      `${REASON_MARKUP}${REASON_MARKUP}<p data-testid="block-detail-prev-hint">`,
    );
    const found = findAmbiguousPrefixLocators(
      extractPrefixLocators(BUGGY_LOCATOR),
      staticIds,
    );
    expect(found[0]?.collidingTestIds).toEqual([
      "block-detail-prev-hint",
      "block-detail-prev-reason",
    ]);
  });

  it("ロケータも固定 testid も空なら何も検知しない", () => {
    expect(findAmbiguousPrefixLocators([], [])).toEqual([]);
    expect(findAmbiguousPrefixLocators([], reasonTestId)).toEqual([]);
  });
});

/** `src/ui/` 直下の `*.spec.ts`（support/ 等のサブディレクトリは対象外）。 */
function listSpecFiles(): string[] {
  return readdirSync(uiDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".spec.ts"))
    .map((entry) => entry.name);
}

/** frontend のソース（描画される data-testid の出所）を再帰的に集める。 */
function listFrontendSources(): string[] {
  return readdirSync(frontendSrcDir, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() && (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")),
    )
    .map((entry) => join(entry.parentPath, entry.name));
}

describe("UI 層 spec の前方一致ロケータの一貫性(Issue #428 再発防止)", () => {
  const staticTestIds = listFrontendSources().flatMap((file) =>
    extractStaticTestIds(readFileSync(file, "utf8")),
  );

  it("frontend から固定 data-testid を実際に収集できている", () => {
    // 収集が空振りしていると以下の検査が常に成功してしまうため、
    // 衝突の実例（Issue #428 の理由文）が拾えていることを確かめる。
    expect(staticTestIds.length).toBeGreaterThan(0);
    expect(staticTestIds).toContainEqual({
      value: "block-detail-prev-reason",
      tag: "p",
    });
  });

  it.each(listSpecFiles())(
    "%s の前方一致ロケータは固定 data-testid と衝突しない",
    (fileName) => {
      const source = readFileSync(resolve(uiDir, fileName), "utf8");
      const ambiguous = findAmbiguousPrefixLocators(
        extractPrefixLocators(source),
        staticTestIds,
      );
      // 失敗時にどの接頭辞がどの固定 testid と衝突するかが分かるようにする。
      expect(
        ambiguous.map((entry) => `${entry.prefix} -> ${entry.collidingTestIds.join(", ")}`),
      ).toEqual([]);
    },
  );
});
