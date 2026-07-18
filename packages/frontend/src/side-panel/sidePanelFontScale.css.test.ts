import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #377: サイドパネル本文の文字サイズ変更は CSS カスタムプロパティ
 * `--side-panel-font-scale` を各セレクタの `font-size: calc(Npx * var(...))`
 * で参照する方式(SidePanel.tsx がルートに倍率を渡すだけ)。jsdom は
 * スタイルシートのカスケードを評価しないため、コンポーネントテストでは
 * 「本文の各要素が実際に倍率へ追従する」ことを検証できない。styles.css の
 * 内容検査で、パネル本文の全対象セレクタが calc() 変換済みであること・
 * ヘッダー(操作クローム)は変換対象外であること・親から継承する2要素は
 * 明示 font-size を持たないことを回帰固定する
 * (`entities/walletPopoverStyles.test.ts` の前例に倣う)。
 *
 * jsdom 環境では import.meta.url が file スキームでないため、cwd から
 * 探索して styles.css を解決する(walletPopoverStyles.test.ts と同じ手当て)。
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

// パネル本文の対象セレプタと、変換前の基準 px。UX設計メモ §6-4 の一覧と一致。
const SCALED_SELECTORS: [string, number][] = [
  // side-panel__body 基準(明示 font-size を持たない子要素の継承元)
  ["side-panel__body", 16],
  // コントラクトソースビュー
  ["contract-source-view__address", 12],
  ["contract-source-view__unavailable", 12],
  ["contract-source-view__filename", 11],
  ["contract-source-view__code", 12],
  // 用語集パネル
  ["glossary-panel__search", 13],
  ["glossary-panel__empty", 12],
  ["glossary-panel__group-heading", 11],
  ["glossary-panel__row-header", 13],
  ["glossary-panel__row-secondary", 11],
  ["glossary-panel__row-definition", 12],
  ["glossary-panel__layer-chip", 11],
  ["glossary-panel__related-label", 11],
  ["glossary-panel__related-chip", 11],
  // 通信ログパネル
  ["comms-log-view__description", 12],
  ["comms-log-view__empty", 12],
  ["comms-log-filter-bar__label", 11],
  ["comms-log-filter-bar__chip", 11],
  ["comms-log-entry__time", 11],
  ["comms-log-entry__subject", 12],
  ["comms-log-entry__body", 12],
  ["comms-log-entry__chip", 10],
];

describe("side panel font scale CSS conversion (Issue #377)", () => {
  it.each(SCALED_SELECTORS)(
    ".%s references --side-panel-font-scale via calc(%dpx)",
    (className, basePx) => {
      const body = ruleBodyFor(className);
      const pattern = new RegExp(
        `font-size:\\s*calc\\(\\s*${basePx}px\\s*\\*\\s*var\\(\\s*--side-panel-font-scale\\s*,\\s*1\\s*\\)\\s*\\)`,
      );
      expect(body).toMatch(pattern);
    },
  );

  it("scales the comms-log node-filter select (descendant selector)", () => {
    // `.comms-log-filter-bar__node select` は子孫セレクタで ruleBodyFor の
    // 単純マッチに乗らないため、直接ソースを検査する。
    expect(css).toMatch(
      /\.comms-log-filter-bar__node select\s*\{[^}]*font-size:\s*calc\(\s*11px\s*\*\s*var\(\s*--side-panel-font-scale\s*,\s*1\s*\)\s*\)/,
    );
  });

  it("leaves comms-log-view__note without an explicit font-size so it inherits the scaled parent", () => {
    // `.comms-log-view__note` は DOM 上 `.comms-log-view__empty`(calc 12px)の
    // 子。明示 font-size を持たせると親の calc() 追従が切れるため、個別の
    // font-size を持たないことを固定する(実装担当の継承判断が正しいことを確認)。
    expect(ruleBodyFor("comms-log-view__note")).not.toMatch(/font-size/);
  });

  it("leaves comms-log-entry__code without an explicit font-size so it inherits the scaled parent", () => {
    // `.comms-log-entry__code` は DOM 上 `.comms-log-entry__body`(calc 12px)の
    // 子。同様に明示 font-size を持たないことを固定する。
    expect(ruleBodyFor("comms-log-entry__code")).not.toMatch(/font-size/);
  });

  it("does not scale the header title (chrome stays a fixed size)", () => {
    // §5: ヘッダー(タイトル・操作ボタン)は拡大対象外。もし将来ヘッダーに
    // 明示 font-size を付ける場合でも --side-panel-font-scale は参照しない。
    const title = ruleBodyFor("side-panel__title");
    expect(title).not.toMatch(/--side-panel-font-scale/);
  });
});
