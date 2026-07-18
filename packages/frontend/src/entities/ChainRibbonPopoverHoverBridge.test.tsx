import type { BlockEntity } from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { HOVER_POPOVER_CLOSE_DELAY_MS } from "../interaction/useHoverPopover.js";
import { ChainRibbonCard } from "./ChainRibbonCard.js";
import type { ChainRibbonTile } from "./chainRibbon.js";
import type { ChainRibbonFlowNode } from "./chainRibbonNode.js";
import { RibbonHoverProvider } from "./RibbonHoverContext.js";

/**
 * Issue #351 の回帰テスト。他の基本表示テストは `ChainRibbonCard.test.tsx`
 * に置き、こちらはポップオーバーがホバー領域の一部として振る舞うことに
 * 関するテストに絞る（1ファイル1責務）。
 *
 * jsdom でのホバー合成イベントの注意点（詳細は
 * docs/worklog/issue-351.md「実装設計メモ」参照）:
 * - `fireEvent.mouseOver`/`mouseOut` + `relatedTarget`（bubbles: true）は、
 *   React の enter/leave 合成ロジック（target と relatedTarget の React
 *   ツリー上の共通祖先を計算する）を正しく再現する。タイル→ポップオーバー
 *   間の「見た目の隙間」を横切る移動の再現に使う
 * - `fireEvent.mouseEnter`/`mouseLeave`（bubbles: false）は dispatch した
 *   要素自身にしか作用せず祖先へ合成されない。単一要素への直接の
 *   enter/leave（このカード自身の他のテストと同じ用法）や、「ある要素の
 *   leave を意図的に一度も発火させない」ことそのものを再現したい場合に使う
 */

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function block(overrides: Partial<BlockEntity> & { hash: string }): BlockEntity {
  return {
    kind: "block",
    number: 1,
    parentHash: "0xparent",
    timestamp: 1_784_798_132,
    receivedAt: {},
    ...overrides,
  };
}

function tile(hash: string, overrides: Partial<BlockEntity> = {}, connectedToPrevious = true): ChainRibbonTile {
  return { block: block({ hash, ...overrides }), connectedToPrevious };
}

function data(overrides: Partial<ChainRibbonFlowNode["data"]> = {}): ChainRibbonFlowNode["data"] {
  return {
    tiles: [],
    txCountByHash: new Map(),
    nodeLabelById: new Map(),
    landingHashes: new Set(),
    blocks: [],
    ...overrides,
  };
}

function renderCard(d: ChainRibbonFlowNode["data"]) {
  const props = { data: d } as unknown as Parameters<typeof ChainRibbonCard>[0];
  return render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <RibbonHoverProvider transactions={[]}>
            <ChainRibbonCard {...props} />
          </RibbonHoverProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
}

describe("ChainRibbonCard popover hover bridge (Issue #351)", () => {
  it("keeps the popover open once the mouse crosses into it, past the close delay", () => {
    renderCard(data({ tiles: [tile("0x1", { number: 42 })] }));

    const tileEl = screen.getByTestId("chain-ribbon-tile-0x1");
    fireEvent.mouseOver(tileEl, { relatedTarget: document.body });
    const popover = screen.getByTestId("chain-ribbon-popover-0x1");

    // タイルを離れて隙間を通過する体（隙間の背景要素へ、というのを
    // document.body で代用）。
    fireEvent.mouseOut(tileEl, { relatedTarget: document.body });
    // 隙間からポップオーバーへ入る。ポップオーバーはタイル div の
    // React ツリー上の子として描画されているため、この mouseover は
    // タイル div の onMouseEnter を再発火させ、保留中のクローズタイマーを
    // 解除する（Issue #351 の本丸の修正）。
    fireEvent.mouseOver(popover, { relatedTarget: document.body });

    act(() => {
      vi.advanceTimersByTime(HOVER_POPOVER_CLOSE_DELAY_MS);
    });

    expect(screen.queryByTestId("chain-ribbon-popover-0x1")).toBeTruthy();
  });

  it("still closes once the mouse actually leaves both the tile and the popover", () => {
    renderCard(data({ tiles: [tile("0x1", { number: 42 })] }));

    const tileEl = screen.getByTestId("chain-ribbon-tile-0x1");
    fireEvent.mouseOver(tileEl, { relatedTarget: document.body });
    const popover = screen.getByTestId("chain-ribbon-popover-0x1");

    fireEvent.mouseOut(tileEl, { relatedTarget: popover });
    fireEvent.mouseOver(popover, { relatedTarget: tileEl });
    // 完全に離れる（ポップオーバーの外の無関係な要素へ）。
    fireEvent.mouseOut(popover, { relatedTarget: document.body });

    act(() => {
      vi.advanceTimersByTime(HOVER_POPOVER_CLOSE_DELAY_MS);
    });

    expect(screen.queryByTestId("chain-ribbon-popover-0x1")).toBeNull();
  });
});
