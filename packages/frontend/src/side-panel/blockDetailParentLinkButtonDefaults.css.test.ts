import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #427 の周辺条件（境界値・将来の再発条件）の固定。
 *
 * `blockDetailParentLinkFont.css.test.ts` は「`.block-detail-view__parent-link`
 * が font-size を上書きしないこと」だけを見る。ここではその修正が成立する
 * ための前提条件と、button 特有の副作用（`<button>` の UA スタイル）を
 * 実測結果に基づいて固定する。
 *
 * headless Chromium（Playwright）で実際に `getComputedStyle` を測った結果、
 * 修正後の状態では親ブロック行の `<button>` と 1個目の `<div class="infra-field">`
 * とで以下がすべて一致することを確認した:
 *   font-size / font-family / font-weight / line-height / letter-spacing /
 *   padding / display / justify-content / gap / color、および行の高さ 21px。
 *
 * ただし Chromium など主要ブラウザの UA スタイルシートは `<button>` に対して
 * `font: 400 13.333px Arial`（= font-style / font-variant / font-weight /
 * font-size / line-height / font-family をまとめてリセットするショートハンド）
 * を当てている。つまり **`<button>` は line-height / font-weight / font-style /
 * letter-spacing 相当の指定を祖先から継承しない**。今それらが一致しているのは
 * 「祖先側が一切それらを宣言していないので、UA 既定値と継承値がたまたま同じ」
 * という条件付きの一致にすぎない。
 *
 * 実測（同じ Chromium で `.side-panel__body` に
 * `line-height: 1.8; font-weight: 300; letter-spacing: 2px` を足した場合）では
 * div 側が line-height 21.6px / font-weight 300 / letter-spacing 2px、
 * button 側は normal / 400 / normal となり、行の高さも 28px 対 21px に
 * ずれた。そのためここでは「サイドパネルの祖先セレクタがこれらを宣言して
 * いないこと」を前提条件として固定し、将来誰かが追加したら
 * Issue #427 と同種の見た目のズレが再発する、と気づけるようにする。
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

/** セレクタ（クラスに限らない）のルールブロック本文を抜き出す。無ければ null。 */
function ruleBodyForSelector(selector: string): string | null {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, "m").exec(css);
  return match ? match[1] : null;
}

// 親ブロック行の `<button>` が font 関連の値を継承する経路上の祖先セレクタ。
// (`:root` → `body` → `.app` → `.side-panel` → `.side-panel__body`)
const ANCESTOR_SELECTORS = [":root", "body", ".app", ".side-panel", ".side-panel__body"];

// `<button>` の UA スタイル `font: ...` ショートハンドがリセットしてしまう
// ため、祖先で宣言しても button 側だけ効かなくなるプロパティ。
const NON_INHERITED_BY_BUTTON = ["line-height", "font-weight", "font-style", "letter-spacing"];

describe("block-detail parent link: button default styles (Issue #427 boundary conditions)", () => {
  it.each(NON_INHERITED_BY_BUTTON)(
    "no side-panel ancestor declares %s, which a <button> would not inherit",
    (property) => {
      for (const selector of ANCESTOR_SELECTORS) {
        const body = ruleBodyForSelector(selector);
        if (body === null) continue; // そのセレクタのルールが無いのは問題ない
        expect(
          new RegExp(`(^|[;\\s])${property}\\s*:`).test(body),
          `${selector} must not declare ${property}`,
        ).toBe(false);
      }
    },
  );

  it("resolves the ancestor selectors it guards (so the guard above is not vacuous)", () => {
    // ルールが1つも見つからないと上の it.each が素通りしてしまうため、
    // 少なくとも `.side-panel__body` は解決できることを確かめる。
    expect(ruleBodyForSelector(".side-panel__body")).not.toBeNull();
    expect(ruleBodyForSelector(".side-panel")).not.toBeNull();
  });

  it("does not re-declare the layout properties owned by .infra-field", () => {
    // `.infra-field` の flex レイアウト・padding をボタン側で上書きすると、
    // 1個目の行と2個目以降の行で行間・ラベル位置がずれる。ボタン化リセットは
    // 「button 既定の枠・背景・フォントファミリーを消す」ことに限定する。
    const body = ruleBodyFor("block-detail-view__parent-link");
    for (const property of ["display", "justify-content", "gap", "padding", "margin"]) {
      expect(new RegExp(`(^|[;\\s])${property}\\s*:`).test(body)).toBe(false);
    }
  });

  it("keeps .infra-field as the single source of the row's box metrics", () => {
    // 上のテストが「ボタン側が持たない」ことしか見ていないため、
    // 実際に `.infra-field` 側が持っていることも固定する。
    const body = ruleBodyFor("infra-field");
    expect(body).toMatch(/display:\s*flex\s*;/);
    expect(body).toMatch(/justify-content:\s*space-between\s*;/);
    expect(body).toMatch(/padding:\s*3px 0\s*;/);
  });

  it("keeps color inherited so the button does not fall back to the UA button color", () => {
    expect(ruleBodyFor("block-detail-view__parent-link")).toMatch(/color:\s*inherit\s*;/);
  });

  it("resets the UA `text-align: center` to left, matching the other button-ized rows", () => {
    // `<button>` の UA 既定は `text-align: center`（div 側は既定の
    // `start`/左寄せ）。他のボタン化リセット（`.contract-list-panel__row` /
    // `.mempool-panel__row` / `.mempool-panel__node-row`）はいずれも
    // `text-align: left` を明示しており、ここでも揃える。hash は空白を
    // 含まない1トークンなので今は折り返しが起きず見た目には出ないが、
    // 明示しておくことで将来 `.infra-field__value` に `overflow-wrap` 等を
    // 足して折り返しを許すようになっても、button 側だけ最終行が中央寄せに
    // ズレる（実測で34pxのズレを確認済み）事態を防げる。
    expect(ruleBodyFor("block-detail-view__parent-link")).toMatch(/text-align:\s*left\s*;/);
  });
});

describe("block-detail parent link vs --side-panel-font-scale (Issue #377 interaction)", () => {
  it("does not reference --side-panel-font-scale, matching the non-button first row", () => {
    // 修正前は button だけが `.side-panel__body` の
    // `calc(16px * var(--side-panel-font-scale, 1))` を継承しており、
    // 文字サイズ変更時は 24px まで拡大していた（実測）。修正後は
    // `.infra-field` の固定 12px に揃い、1個目の行と同じ挙動になる。
    // 「2行の見た目を揃える」ことが Issue #427 の完了条件なので、
    // ボタン側にだけスケール参照を足し直さないことを固定する。
    expect(ruleBodyFor("block-detail-view__parent-link")).not.toMatch(/--side-panel-font-scale/);
  });

  it("keeps .infra-field unscaled because it is shared with canvas popovers", () => {
    // `.infra-field` は WalletPopover / ChainRibbonPopover（キャンバス上の
    // ポップオーバー。サイドパネルの文字サイズ設定の対象外）でも使われる。
    // ここに `--side-panel-font-scale` を足すとサイドパネル外の表示まで
    // 巻き込むため、固定 px のままにしてある。
    const body = ruleBodyFor("infra-field");
    expect(body).toMatch(/font-size:\s*12px\s*;/);
    expect(body).not.toMatch(/--side-panel-font-scale/);
  });

  it("still scales the header hash, so the panel keeps its existing scale behaviour", () => {
    // ブロック詳細パネルでスケール対象なのはヘッダーの短縮 hash のみ。
    // Issue #427 の修正がこの既存挙動を巻き込んで壊していないことを確認する。
    expect(ruleBodyFor("block-detail-view__hash")).toMatch(
      /font-size:\s*calc\(\s*12px\s*\*\s*var\(\s*--side-panel-font-scale\s*,\s*1\s*\)\s*\)/,
    );
  });
});
