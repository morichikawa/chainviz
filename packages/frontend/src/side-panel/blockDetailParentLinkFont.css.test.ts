import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #427回帰テスト。ブロック詳細パネルの親ブロック行は、1個目
 * （`parent === undefined`、`<Field>` で描画される非button要素）と
 * 2個目以降（`parent !== undefined`、`.block-detail-view__parent-link`
 * クラスを持つ `<button>` 要素）とで見た目を揃える必要がある。
 *
 * 原因は `.block-detail-view__parent-link` に `font: inherit;` という
 * ショートハンドが指定されていたこと。`font` ショートハンドは
 * `font-size` を含む全サブプロパティを一括で上書きするため、CSS
 * ソース順で後にあるこのルールが `.infra-field` の `font-size: 12px`
 * を上書きし、button はサイドパネル本文の大きい font-size を継承して
 * しまっていた（同じ詳細度の単一クラスセレクタなので、`.infra-field`
 * より後に定義されている方が勝つ）。
 *
 * jsdom はスタイルシートのカスケードを評価しないため実レイアウトでの
 * font-size を直接計算できない（`sidePanelFontScale.css.test.ts` と同様）。
 * 代わりに styles.css の宣言内容そのものを検査し、`.block-detail-view__parent-link`
 * が `font-size` に触れる宣言（`font` ショートハンド含む）を持たないこと、
 * button のデフォルトフォントファミリーだけをリセットする
 * `font-family: inherit` を使っていることを固定する。
 */
function findStylesFile(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i += 1) {
    for (const candidate of [
      resolve(dir, "packages/frontend/src/styles.css"),
      resolve(dir, "src/styles.css"),
    ]) {
      if (existsSync(candidate)) return candidate;
    }
    dir = dirname(dir);
  }
  throw new Error("styles.css not found from cwd");
}

const css = readFileSync(findStylesFile(), "utf8");

/** 指定クラスのルールブロック本文(波括弧の中身)を抜き出す。 */
function ruleBodyFor(className: string): string {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\.${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no CSS rule found for .${className}`);
  return match[1];
}

describe("block-detail-view__parent-link font (Issue #427 regression)", () => {
  it("does not use the `font` shorthand, which would reset font-size", () => {
    const body = ruleBodyFor("block-detail-view__parent-link");
    // `font-family:` は許容するが、`font:` ショートハンド自体は禁止する
    // （font-family の直前は "-" のため \bfont\s*: にはマッチしない）。
    expect(body).not.toMatch(/\bfont\s*:/);
  });

  it("does not declare font-size directly, so .infra-field's font-size wins", () => {
    const body = ruleBodyFor("block-detail-view__parent-link");
    expect(body).not.toMatch(/font-size/);
  });

  it("resets only the button's default font-family via `font-family: inherit`", () => {
    const body = ruleBodyFor("block-detail-view__parent-link");
    expect(body).toMatch(/font-family:\s*inherit\s*;/);
  });

  it("keeps .infra-field's font-size at 12px as the shared baseline", () => {
    // 1個目(非button)・2個目以降(button)の両方がこの値に揃うことを固定する。
    const body = ruleBodyFor("infra-field");
    expect(body).toMatch(/font-size:\s*12px\s*;/);
  });
});
