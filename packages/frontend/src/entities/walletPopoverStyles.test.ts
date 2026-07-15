import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Issue #320: WalletPopover の tx 一覧スクロール対応は CSS（styles.css）側の
 * 責務で、コンポーネント側のテスト（WalletPopover.scroll.test.tsx）は
 * クラス名の付与までしか検証できない（jsdom はスタイルシートの
 * カスケードを評価しないため）。実際にスクロール可能な CSS 宣言が
 * styles.css に存在することを、ファイル内容の検査で固定する
 * （`packages/frontend/src/entities/peerEdge.test.ts` の
 * `NETWORK_COLORS palette separation` が同様に styles.css の値を
 * リテラルで回帰固定している前例に倣う）。
 *
 * jsdom 環境では import.meta.url が file スキームでないため（`glossary/parse.test.ts`
 * と同じ制約）、cwd から探索して解決する。
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

/** 指定クラスのルールブロック本文（波括弧の中身）を抜き出す。 */
function ruleBodyFor(className: string): string {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`\\.${escaped}\\s*\\{([^}]*)\\}`).exec(css);
  if (!match) throw new Error(`no CSS rule found for .${className}`);
  return match[1];
}

describe("wallet-popover tx list scroll styles (Issue #320)", () => {
  it("caps the tx list height and enables vertical scrolling", () => {
    const body = ruleBodyFor("wallet-popover__tx-list");
    expect(body).toMatch(/max-height:\s*220px/);
    expect(body).toMatch(/overflow-y:\s*auto/);
  });

  it("resets the browser default list bullets/indentation on the tx list", () => {
    const body = ruleBodyFor("wallet-popover__tx-list");
    expect(body).toMatch(/list-style:\s*none/);
    expect(body).toMatch(/padding:\s*0/);
  });

  it("shows a persistently visible thin scrollbar (Firefox)", () => {
    const body = ruleBodyFor("wallet-popover__tx-list");
    expect(body).toMatch(/scrollbar-width:\s*thin/);
  });

  it("shows a persistently visible thin scrollbar (WebKit/Blink)", () => {
    expect(css).toMatch(
      /\.wallet-popover__tx-list::-webkit-scrollbar\s*\{[^}]*width:\s*\d+px/,
    );
    expect(css).toMatch(
      /\.wallet-popover__tx-list::-webkit-scrollbar-thumb\s*\{/,
    );
  });

  it("caps the popover's own width", () => {
    const body = ruleBodyFor("wallet-popover");
    expect(body).toMatch(/max-width:\s*360px/);
  });
});
