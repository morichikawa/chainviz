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

  it("keeps the tile window frozen through the gap-crossing moment when hoveredBlockHash has already reset to null", () => {
    // issue-298 の既知の残課題（issue-351 で解消）: タイル div の
    // mouseleave は即座に hoveredBlockHash を null に戻すが、ポップオーバー
    // 自体は閉じるまでの猶予がある。その間も表示窓は凍結され続けるべき。
    const tilesA = [tile("0x1", { number: 1 }), tile("0x2", { number: 2 })];
    const { rerender } = render(
      <ReactFlowProvider>
        <LanguageProvider initialLanguage="ja">
          <GlossaryProvider glossary={{}}>
            <RibbonHoverProvider transactions={[]}>
              <ChainRibbonCard
                {...({ data: data({ tiles: tilesA }) } as unknown as Parameters<
                  typeof ChainRibbonCard
                >[0])}
              />
            </RibbonHoverProvider>
          </GlossaryProvider>
        </LanguageProvider>
      </ReactFlowProvider>,
    );

    const tileEl = screen.getByTestId("chain-ribbon-tile-0x2");
    fireEvent.mouseOver(tileEl, { relatedTarget: document.body });
    // タイルを離れ、まだポップオーバーへ到達していない（隙間の途中）。
    // hoveredBlockHash は既に null に戻っているはず。
    fireEvent.mouseOut(tileEl, { relatedTarget: document.body });

    const tilesB = [tile("0x2", { number: 2 }), tile("0x3", { number: 3 })];
    rerender(
      <ReactFlowProvider>
        <LanguageProvider initialLanguage="ja">
          <GlossaryProvider glossary={{}}>
            <RibbonHoverProvider transactions={[]}>
              <ChainRibbonCard
                {...({ data: data({ tiles: tilesB }) } as unknown as Parameters<
                  typeof ChainRibbonCard
                >[0])}
              />
            </RibbonHoverProvider>
          </GlossaryProvider>
        </LanguageProvider>
      </ReactFlowProvider>,
    );

    // ポップオーバーの遅延クローズがまだ効いている間は、hoveredBlockHash が
    // null に戻っていても表示窓は前進しない。
    expect(screen.getByTestId("chain-ribbon-tile-0x1")).toBeTruthy();
    expect(screen.queryByTestId("chain-ribbon-tile-0x3")).toBeNull();
  });

  it("does not leave the highlight stuck when the popover closes while the mouse never fired the parent row's own mouseleave (Issue #351 stuck-highlight regression)", () => {
    renderCard(
      data({
        tiles: [
          tile("0xparent-tile", { number: 1 }),
          tile("0xchild-tile", { number: 2, parentHash: "0xparent-tile" }, true),
        ],
      }),
    );

    fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-tile-0xchild-tile"));
    fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-popover-parent-0xchild-tile"));
    expect(screen.getByTestId("chain-ribbon-tile-0xparent-tile").className).toContain(
      "chain-ribbon-tile--highlight",
    );

    // ポップオーバーが閉じる瞬間もマウスは行の上にあり続けた体（行自身の
    // mouseleave は一度も発火しない）。タイル自体は離れたことにして
    // クローズタイマーを起動し、そのまま満了させる。
    fireEvent.mouseLeave(screen.getByTestId("chain-ribbon-tile-0xchild-tile"));
    act(() => {
      vi.advanceTimersByTime(HOVER_POPOVER_CLOSE_DELAY_MS);
    });

    expect(screen.queryByTestId("chain-ribbon-popover-0xchild-tile")).toBeNull();
    expect(screen.getByTestId("chain-ribbon-tile-0xparent-tile").className).not.toContain(
      "chain-ribbon-tile--highlight",
    );
  });

  it("highlights the older-blocks indicator when the highlighted parent hash is off-screen (recommended enhancement)", () => {
    // 表示窓は 0x1(最古)〜0x2 のみを含み、0x1 の親（0xoffscreen-parent）は
    // 窓の外にある体。
    renderCard(
      data({
        tiles: [
          tile("0x1", { number: 10, parentHash: "0xoffscreen-parent" }),
          tile("0x2", { number: 11, parentHash: "0x1" }, true),
        ],
      }),
    );

    expect(screen.getByTestId("chain-ribbon-older").className).not.toContain(
      "chain-ribbon-card__older--highlight",
    );

    fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-tile-0x1"));
    fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-popover-parent-0x1"));
    expect(screen.getByTestId("chain-ribbon-older").className).toContain(
      "chain-ribbon-card__older--highlight",
    );

    fireEvent.mouseLeave(screen.getByTestId("chain-ribbon-popover-parent-0x1"));
    expect(screen.getByTestId("chain-ribbon-older").className).not.toContain(
      "chain-ribbon-card__older--highlight",
    );
  });

  describe("hover-area boundary edge cases (Issue #351)", () => {
    it("moves the highlight to the new tile's parent when hovering consecutive tiles (no stale highlight left behind)", () => {
      // 3タイルを連続してホバーする際、直前タイルの強調が新しいタイルの
      // 親へ正しく移り、古い強調が残らないこと（parentHighlightHash は
      // カード内で1つだけ共有される単一 state のため、対象の切り替えが
      // 正しく行われるかが要）。
      renderCard(
        data({
          tiles: [
            tile("0xp", { number: 1 }),
            tile("0xa", { number: 2, parentHash: "0xp" }, true),
            tile("0xb", { number: 3, parentHash: "0xa" }, true),
          ],
        }),
      );

      // タイルA の親行をホバー → 0xp（タイルP）が強調される。
      fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-tile-0xa"));
      fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-popover-parent-0xa"));
      expect(screen.getByTestId("chain-ribbon-tile-0xp").className).toContain(
        "chain-ribbon-tile--highlight",
      );

      // 行A を離れて（強調解除）タイルB へ移り、その親行をホバー →
      // 強調は 0xa（タイルA）へ移る。
      fireEvent.mouseLeave(screen.getByTestId("chain-ribbon-popover-parent-0xa"));
      fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-tile-0xb"));
      fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-popover-parent-0xb"));

      expect(screen.getByTestId("chain-ribbon-tile-0xa").className).toContain(
        "chain-ribbon-tile--highlight",
      );
      // 古い強調（タイルP）は残っていない。
      expect(screen.getByTestId("chain-ribbon-tile-0xp").className).not.toContain(
        "chain-ribbon-tile--highlight",
      );
    });

    it("does not throw when the whole card unmounts while a parent row is hovered (world-state rebuild path)", () => {
      // ワールドステート更新でチェーンリボンカードごと消える（＝ツリー全体の
      // unmount）経路。ポップオーバーの cleanup が onParentHover(null) を
      // 呼ぶが、その時点でカードも unmount 中のため、例外や未処理の警告に
      // ならないことを確認する（通常のホバー解除以外の unmount タイミング）。
      const { unmount } = renderCard(
        data({
          tiles: [
            tile("0xp", { number: 1 }),
            tile("0xc", { number: 2, parentHash: "0xp" }, true),
          ],
        }),
      );

      fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-tile-0xc"));
      fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-popover-parent-0xc"));
      expect(screen.getByTestId("chain-ribbon-tile-0xp").className).toContain(
        "chain-ribbon-tile--highlight",
      );

      expect(() => unmount()).not.toThrow();
    });
  });

  describe("older-blocks indicator boundary values (Issue #351)", () => {
    it("highlights the older indicator when the only tile's parent is inherently off-screen", () => {
      // タイルが1件だけ = その親は必ず表示窓の外（境界: 最小件数）。
      renderCard(data({ tiles: [tile("0xonly", { number: 5, parentHash: "0xoff" })] }));

      fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-tile-0xonly"));
      fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-popover-parent-0xonly"));
      expect(screen.getByTestId("chain-ribbon-older").className).toContain(
        "chain-ribbon-card__older--highlight",
      );
    });

    it("does not highlight the older indicator when the hovered parent is an in-window tile", () => {
      // 親が表示窓内のタイルを指すとき（0xc の親 = 0xp は窓内）は、直前タイル
      // 自体が強調されるので「⋯」は光らせない（二重強調にしない）。
      renderCard(
        data({
          tiles: [
            tile("0xp", { number: 1 }),
            tile("0xc", { number: 2, parentHash: "0xp" }, true),
          ],
        }),
      );

      fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-tile-0xc"));
      fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-popover-parent-0xc"));
      expect(screen.getByTestId("chain-ribbon-tile-0xp").className).toContain(
        "chain-ribbon-tile--highlight",
      );
      expect(screen.getByTestId("chain-ribbon-older").className).not.toContain(
        "chain-ribbon-card__older--highlight",
      );
      // QA差し戻し対応（Issue #351）: ホバー中タイル自身（0xc）は、自分の
      // 親ブロック行を見ている間は自己強調が抑制される。強調されるのは
      // 常に親タイル1つだけ(0xp)。
      expect(screen.getByTestId("chain-ribbon-tile-0xc").className).not.toContain(
        "chain-ribbon-tile--highlight",
      );
    });

    it("suppresses the hovered tile's own self-highlight only while its own parent row is hovered, restoring it once the row is left", () => {
      // QA差し戻し対応（Issue #351）: isReverseHighlighted はタイル自身の
      // 直接ホバーでも立つため、「親ブロック」行ホバー中は「ホバー中タイル
      // (self) + 親タイル」の2つが同時に光っていた。行を離れれば
      // isDrivingParentHighlight は false に戻り、タイル自身の直接ホバーに
      // よる自己強調（他機能。chainRibbonCrossHighlight.test.tsx参照）は
      // 復活する。
      renderCard(
        data({
          tiles: [
            tile("0xp", { number: 1 }),
            tile("0xc", { number: 2, parentHash: "0xp" }, true),
          ],
        }),
      );
      const tileC = screen.getByTestId("chain-ribbon-tile-0xc");

      fireEvent.mouseEnter(tileC);
      // 親行を見る前は、直接ホバー中のタイル自身が通常どおり光る。
      expect(tileC.className).toContain("chain-ribbon-tile--highlight");

      const rowC = screen.getByTestId("chain-ribbon-popover-parent-0xc");
      fireEvent.mouseEnter(rowC);
      // 親行を見ている間は自己強調が抑制され、親タイルだけが光る。
      expect(tileC.className).not.toContain("chain-ribbon-tile--highlight");
      expect(screen.getByTestId("chain-ribbon-tile-0xp").className).toContain(
        "chain-ribbon-tile--highlight",
      );

      // 行を離れて、まだタイル(0xc)自身の領域には留まっている体
      // （タイル自体はまだ直接ホバー中のまま）。`fireEvent.mouseLeave`は
      // relatedTarget未指定だとReactツリーの祖先(=このポップオーバーの
      // 呼び出し元であるタイルdiv)まで一緒にleaveしてしまうため
      // （jsdomでのhover合成イベントの注意点。docs/worklog/issue-351.md
      // 参照）、`mouseOut` + `relatedTarget`でタイル自身は共有祖先として
      // 除外されるようにする。
      fireEvent.mouseOut(rowC, { relatedTarget: tileC });
      // タイル自身への直接ホバーは継続しているため自己強調が復活し、
      // 親タイルの強調は消える。
      expect(tileC.className).toContain("chain-ribbon-tile--highlight");
      expect(screen.getByTestId("chain-ribbon-tile-0xp").className).not.toContain(
        "chain-ribbon-tile--highlight",
      );
    });

    it("does not leave the older indicator stuck when the popover closes without the parent row's own mouseleave", () => {
      // 「⋯」強調は parentHighlightHash から導出されるため、固着バグ
      // （行の mouseleave 未発火のまま unmount）が「⋯」側にも波及しない
      // ことを確認する（強調タイル側の回帰テストの姉妹版）。
      renderCard(data({ tiles: [tile("0xonly", { number: 5, parentHash: "0xoff" })] }));

      fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-tile-0xonly"));
      fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-popover-parent-0xonly"));
      expect(screen.getByTestId("chain-ribbon-older").className).toContain(
        "chain-ribbon-card__older--highlight",
      );

      // 行自身の mouseleave は発火させず、タイルを離れてクローズタイマーを
      // 満了させる。
      fireEvent.mouseLeave(screen.getByTestId("chain-ribbon-tile-0xonly"));
      act(() => {
        vi.advanceTimersByTime(HOVER_POPOVER_CLOSE_DELAY_MS);
      });

      expect(screen.queryByTestId("chain-ribbon-popover-0xonly")).toBeNull();
      expect(screen.getByTestId("chain-ribbon-older").className).not.toContain(
        "chain-ribbon-card__older--highlight",
      );
    });
  });
});
