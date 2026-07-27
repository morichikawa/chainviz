// Issue #430 で削除した「攻撃を学ぶ」専用行（`chain-ribbon-card__attack-demo-row`）
// の痕跡が残っていない／再び生えていないことの回帰ガード。#430 は #414 と #415 の
// 設計が衝突したまま両方 main に入ってしまったことが原因なので、同じ形の
// 取りこぼし（DOM から消したのに CSS や文言だけ残る、マージで専用行が復活する）
// を検出できるようにしておく。
//
// 見るのは3層すべて:
//   - DOM: 専用行の要素が描画されない／入口が二重に出ない
//   - CSS: 専用行のためのルールが styles.css から消えている（消し忘れは
//     lint でもビルドでも検出されない。逆に、まだ使われているポップオーバー側の
//     同種クラスを巻き込んで消していないことも確認する）
//   - i18n: 専用行のラベルキーが messages.ts から消えている
//
// styles.css をファイル内容として読む手法は
// `packages/frontend/src/entities/walletPopoverStyles.test.ts` の前例に倣う
// （jsdom はスタイルシートのカスケードを評価しないため）。
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { messages } from "../i18n/messages.js";
import { SidePanelProvider } from "../side-panel/SidePanelContext.js";
import { ChainRibbonCard } from "./ChainRibbonCard.js";
import type { ChainRibbonFlowNode } from "./chainRibbonNode.js";
import { RibbonHoverProvider } from "./RibbonHoverContext.js";

afterEach(cleanup);

/** #430 で消したクラス（カード側の専用行とその中身）。 */
const REMOVED_CLASSES = [
  "chain-ribbon-card__attack-demo-row",
  "chain-ribbon-card__attack-demo-label",
  "chain-ribbon-card__long-range-demo-open",
] as const;

/** 残っていなければならないクラス（メニュー項目・ポップオーバー側の文脈導線）。 */
const KEPT_CLASSES = [
  "chain-ribbon-card__demo-menu-item",
  "chain-ribbon-popover__long-range-demo-open",
] as const;

function data(): ChainRibbonFlowNode["data"] {
  return {
    tiles: [],
    txCountByHash: new Map(),
    nodeLabelById: new Map(),
    landingHashes: new Set(),
    blocks: [],
  };
}

function props() {
  return { data: data() } as unknown as Parameters<typeof ChainRibbonCard>[0];
}

function renderCard() {
  return render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <SidePanelProvider>
            <RibbonHoverProvider transactions={[]}>
              <ChainRibbonCard {...props()} />
            </RibbonHoverProvider>
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
}

function card(): HTMLElement {
  return screen.getByTestId("chain-ribbon-card");
}

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

/**
 * クラスセレクタの出現を「単語境界つき」で探す。単純な部分一致だと
 * `.chain-ribbon-card__demo-menu-item` が `…-itemX` にも一致してしまい、
 * リネームを見逃す。
 */
function selectorPattern(className: string): RegExp {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\.${escaped}(?![\\w-])`);
}

describe("ChainRibbonCard: the dedicated attack-demo row is gone from the DOM (Issue #430)", () => {
  it.each(REMOVED_CLASSES)("renders no element with the .%s class", (className) => {
    renderCard();
    expect(card().querySelector(`.${className}`)).toBeNull();
  });

  it("renders the long-range entry only once, inside the menu", () => {
    renderCard();
    // 専用行が復活すると同じ testid の要素が2つになる（そのとき
    // getByTestId を使う既存テストは「複数見つかった」で落ちるが、
    // ここでは重複そのものを明示的に禁止しておく）。
    const entries = screen.getAllByTestId("chain-ribbon-long-range-demo-open");
    expect(entries).toHaveLength(1);
    expect(entries[0].closest("details")).toBe(
      screen.getByTestId("chain-ribbon-demo-menu-open").closest("details"),
    );
    // 他の2項目と同じクラスを共有している＝見た目も揃っている。
    expect(entries[0].className).toContain("chain-ribbon-card__demo-menu-item");
  });

  it("puts every direct child row of the card either in the header, subtitle row, or ribbon body", () => {
    // 専用行はカード直下の独立した行だった。カード直下の要素が想定の
    // 顔ぶれだけであることを固定し、入口用の行が再び足されたら気づけるようにする。
    renderCard();
    const childClasses = [...card().children].map((child) => child.className);
    expect(childClasses).toEqual([
      "chain-ribbon-card__header",
      "chain-ribbon-card__subtitle-row",
      "chain-ribbon-card__empty",
    ]);
  });
});

describe("styles.css: the dedicated attack-demo row's rules are removed (Issue #430)", () => {
  it.each(REMOVED_CLASSES)("has no CSS rule left for .%s", (className) => {
    expect(css).not.toMatch(selectorPattern(className));
  });

  it.each(KEPT_CLASSES)("still styles .%s (not removed by mistake)", (className) => {
    expect(css).toMatch(selectorPattern(className));
  });
});

describe("messages.ts: the dedicated row's label key is removed (Issue #430)", () => {
  it("no longer defines chainRibbon.attackDemoRowLabel", () => {
    expect(Object.keys(messages)).not.toContain("chainRibbon.attackDemoRowLabel");
  });

  it("leaves no message key referring to the removed row", () => {
    const leftovers = Object.keys(messages).filter((key) => /attackDemoRow/i.test(key));
    expect(leftovers).toEqual([]);
  });

  it("keeps the shared entry label used by both the menu and the popover", () => {
    // 専用行だけを消すつもりで longRangeDemo.open まで巻き込んでいないこと
    // （ポップオーバー側の文脈導線も同じキーを使っている）。
    expect(messages["longRangeDemo.open"].ja.trim().length).toBeGreaterThan(0);
    expect(messages["longRangeDemo.open"].en.trim().length).toBeGreaterThan(0);
  });
});
