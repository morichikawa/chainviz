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
import { RibbonHoverProvider, useRibbonHover } from "./RibbonHoverContext.js";

/**
 * カード外（tx/活動チップ相当）からの逆方向ホバーを模す最小限のプローブ。
 * `RibbonHoverContext.setHoveredBlockHash` を直接呼ぶことで、
 * `ChainRibbonCard` 自身のタイル要素を経由しない「外部からの」ホバーを
 * 再現する（`WalletCard`/`ContractCard` の tx/活動チップと同じ経路）。
 */
function ReverseHoverProbe({ blockHash }: { blockHash: string }) {
  const { setHoveredBlockHash } = useRibbonHover();
  return (
    <span
      data-testid="reverse-hover-probe"
      onMouseEnter={() => setHoveredBlockHash(blockHash)}
      onMouseLeave={() => setHoveredBlockHash(null)}
    />
  );
}

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

function tree(d: ChainRibbonFlowNode["data"]) {
  const props = { data: d } as unknown as Parameters<typeof ChainRibbonCard>[0];
  return (
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <RibbonHoverProvider transactions={[]}>
            <ChainRibbonCard {...props} />
          </RibbonHoverProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>
  );
}

function renderCard(data: ChainRibbonFlowNode["data"]) {
  return render(tree(data));
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
    ...overrides,
  };
}

describe("ChainRibbonCard", () => {
  it("shows the waiting-for-first-block empty state when there are no tiles", () => {
    renderCard(data());
    expect(screen.getByTestId("chain-ribbon-empty")).toBeTruthy();
    expect(screen.queryByTestId("chain-ribbon-older")).toBeNull();
  });

  it("omits the latest-block-number header while empty (no block observed yet)", () => {
    renderCard(data());
    expect(screen.queryByTestId("chain-ribbon-latest")).toBeNull();
  });

  it("renders the latest block number in the header", () => {
    renderCard(data({ tiles: [tile("0x1", { number: 131 })] }));
    expect(screen.getByTestId("chain-ribbon-latest").textContent).toBe("#131");
  });

  it("renders one tile per entry with its block number and shortened hash", () => {
    renderCard(
      data({
        tiles: [tile("0xaaaa000000000000", { number: 1 }), tile("0xbbbb000000000000", { number: 2 })],
      }),
    );
    expect(screen.getByTestId("chain-ribbon-tile-0xaaaa000000000000")).toBeTruthy();
    expect(screen.getByTestId("chain-ribbon-tile-0xbbbb000000000000")).toBeTruthy();
  });

  it("shows the older-blocks indicator once at least one tile is shown", () => {
    renderCard(data({ tiles: [tile("0x1")] }));
    expect(screen.getByTestId("chain-ribbon-older")).toBeTruthy();
  });

  it("shows a tx count badge only when the block has a nonzero counted tx", () => {
    renderCard(
      data({
        tiles: [tile("0xwithtx"), tile("0xempty")],
        txCountByHash: new Map([["0xwithtx", 3]]),
      }),
    );
    expect(screen.getByTestId("chain-ribbon-tile-tx-0xwithtx").textContent).toBe("3 tx");
    expect(screen.queryByTestId("chain-ribbon-tile-tx-0xempty")).toBeNull();
  });

  it("marks the first tile's connector as absent (no comparison target)", () => {
    const { container } = renderCard(data({ tiles: [tile("0x1")] }));
    expect(container.querySelectorAll(".chain-ribbon-card__link")).toHaveLength(0);
  });

  it("marks connected vs. broken links between tiles", () => {
    const { container } = renderCard(
      data({
        tiles: [tile("0x1", {}, false), tile("0x2", {}, true), tile("0x3", {}, false)],
      }),
    );
    const links = container.querySelectorAll(".chain-ribbon-card__link");
    expect(links).toHaveLength(2);
    expect(links[0].className).toContain("chain-ribbon-card__link--connected");
    expect(links[1].className).toContain("chain-ribbon-card__link--broken");
  });

  it("applies the landing animation class only to tiles in landingHashes", () => {
    renderCard(
      data({ tiles: [tile("0x1"), tile("0x2")], landingHashes: new Set(["0x2"]) }),
    );
    expect(screen.getByTestId("chain-ribbon-tile-0x1").className).not.toContain(
      "chain-ribbon-tile--landing",
    );
    expect(screen.getByTestId("chain-ribbon-tile-0x2").className).toContain(
      "chain-ribbon-tile--landing",
    );
  });

  it("shows a popover with block number/hash/time on tile hover, closing only after the close delay", () => {
    renderCard(data({ tiles: [tile("0x1", { number: 42 })] }));
    expect(screen.queryByTestId("chain-ribbon-popover-0x1")).toBeNull();

    const t = screen.getByTestId("chain-ribbon-tile-0x1");
    fireEvent.mouseEnter(t);
    const popover = screen.getByTestId("chain-ribbon-popover-0x1");
    expect(popover.textContent).toContain("#42");

    fireEvent.mouseLeave(t);
    expect(screen.getByTestId("chain-ribbon-popover-0x1")).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(HOVER_POPOVER_CLOSE_DELAY_MS);
    });
    expect(screen.queryByTestId("chain-ribbon-popover-0x1")).toBeNull();
  });

  it("shows the empty-tx fallback text in the popover for a block with no counted tx", () => {
    renderCard(data({ tiles: [tile("0x1")] }));
    fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-tile-0x1"));
    expect(screen.getByTestId("chain-ribbon-popover-0x1").textContent).toContain(
      "空ブロック",
    );
  });

  it("shows received-by entries ordered by offset with resolved node labels", () => {
    renderCard(
      data({
        tiles: [
          tile("0x1", { receivedAt: { n1: 1100, n2: 1000 } }),
        ],
        nodeLabelById: new Map([
          ["n1", "chainviz-reth-1"],
          ["n2", "chainviz-reth-2"],
        ]),
      }),
    );
    fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-tile-0x1"));
    const popover = screen.getByTestId("chain-ribbon-popover-0x1");
    const text = popover.textContent ?? "";
    expect(text.indexOf("chainviz-reth-2")).toBeLessThan(text.indexOf("chainviz-reth-1"));
    expect(text).toContain("+100ms");
  });

  it("highlights the previous tile while hovering the popover's parent-block row", () => {
    renderCard(
      data({
        tiles: [
          tile("0xparent-tile", { number: 1 }),
          tile("0xchild-tile", { number: 2, parentHash: "0xparent-tile" }, true),
        ],
      }),
    );
    fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-tile-0xchild-tile"));
    const parentRow = screen.getByTestId("chain-ribbon-popover-parent-0xchild-tile");

    expect(screen.getByTestId("chain-ribbon-tile-0xparent-tile").className).not.toContain(
      "chain-ribbon-tile--highlight",
    );
    fireEvent.mouseEnter(parentRow);
    expect(screen.getByTestId("chain-ribbon-tile-0xparent-tile").className).toContain(
      "chain-ribbon-tile--highlight",
    );
    fireEvent.mouseLeave(parentRow);
    expect(screen.getByTestId("chain-ribbon-tile-0xparent-tile").className).not.toContain(
      "chain-ribbon-tile--highlight",
    );
  });

  describe("freezing the tile window while hovered (QA regression: highlight lost when the window advances mid-hover)", () => {
    it("keeps the hovered tile visible and highlighted even after the window would otherwise have advanced past it", () => {
      const tilesA = [tile("0x1", { number: 1 }), tile("0x2", { number: 2 })];
      const { rerender } = render(tree(data({ tiles: tilesA })));

      fireEvent.mouseEnter(screen.getByTestId("chain-ribbon-tile-0x2"));
      expect(screen.getByTestId("chain-ribbon-tile-0x2").className).toContain(
        "chain-ribbon-tile--highlight",
      );

      // 新しいブロックが届いて表示窓が前進した体（0x1 が窓外、0x3 が追加）。
      const tilesB = [tile("0x2", { number: 2 }), tile("0x3", { number: 3 })];
      rerender(tree(data({ tiles: tilesB })));

      // 凍結中なのでホバー対象のタイルは消えず、ハイライトも保持され続ける。
      expect(screen.getByTestId("chain-ribbon-tile-0x1")).toBeTruthy();
      expect(screen.getByTestId("chain-ribbon-tile-0x2")).toBeTruthy();
      expect(screen.getByTestId("chain-ribbon-tile-0x2").className).toContain(
        "chain-ribbon-tile--highlight",
      );
      expect(screen.queryByTestId("chain-ribbon-tile-0x3")).toBeNull();
    });

    it("resumes tracking the latest tiles once the hover ends", () => {
      const tilesA = [tile("0x1", { number: 1 }), tile("0x2", { number: 2 })];
      const { rerender } = render(tree(data({ tiles: tilesA })));

      const hoveredTile = screen.getByTestId("chain-ribbon-tile-0x2");
      fireEvent.mouseEnter(hoveredTile);

      const tilesB = [tile("0x2", { number: 2 }), tile("0x3", { number: 3 })];
      rerender(tree(data({ tiles: tilesB })));
      expect(screen.queryByTestId("chain-ribbon-tile-0x3")).toBeNull(); // まだ凍結中

      fireEvent.mouseLeave(screen.getByTestId("chain-ribbon-tile-0x2"));
      expect(screen.getByTestId("chain-ribbon-tile-0x3")).toBeTruthy();
      expect(screen.queryByTestId("chain-ribbon-tile-0x1")).toBeNull();
    });

    it("also freezes for the reverse direction (hoveredBlockHash set from outside via context, not from this tile)", () => {
      const tilesA = [tile("0x1", { number: 1 }), tile("0x2", { number: 2 })];

      function Scene({ tiles }: { tiles: ChainRibbonTile[] }) {
        const props = {
          data: data({ tiles }),
        } as unknown as Parameters<typeof ChainRibbonCard>[0];
        return (
          <ReactFlowProvider>
            <LanguageProvider initialLanguage="ja">
              <GlossaryProvider glossary={{}}>
                <RibbonHoverProvider transactions={[]}>
                  <ChainRibbonCard {...props} />
                  {/* このカードの外からのホバー（tx/活動チップ相当）を模す
                      最小限のプローブ要素。 */}
                  <ReverseHoverProbe blockHash="0x2" />
                </RibbonHoverProvider>
              </GlossaryProvider>
            </LanguageProvider>
          </ReactFlowProvider>
        );
      }

      const { rerender } = render(<Scene tiles={tilesA} />);
      fireEvent.mouseEnter(screen.getByTestId("reverse-hover-probe"));
      expect(screen.getByTestId("chain-ribbon-tile-0x2").className).toContain(
        "chain-ribbon-tile--highlight",
      );

      const tilesB = [tile("0x2", { number: 2 }), tile("0x3", { number: 3 })];
      rerender(<Scene tiles={tilesB} />);

      expect(screen.getByTestId("chain-ribbon-tile-0x2")).toBeTruthy();
      expect(screen.getByTestId("chain-ribbon-tile-0x2").className).toContain(
        "chain-ribbon-tile--highlight",
      );
    });
  });
});
