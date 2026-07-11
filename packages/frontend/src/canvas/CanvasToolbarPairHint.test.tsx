import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOVER_POPOVER_CLOSE_DELAY_MS } from "../interaction/useHoverPopover.js";
import { node, renderToolbar } from "./canvasToolbarHarness.js";

// Issue #251: ノード追加ボタンのツールチップに追加された「なぜ2枚1組なのか」の
// 2段目（GlossaryTerm(el-cl-separation) 埋め込み）に関する検証。基本ケースに
// 加えて、言語切り替え・回帰（ワークベンチ側に漏れない）・ネストしたホバーの
// 独立性などの境界/異常系を含める。

afterEach(cleanup);

const elBoot = () =>
  node({ id: "reth-1", containerName: "chainviz-reth-1", p2pRole: "bootnode" });
const clBoot = () =>
  node({
    id: "lh-1",
    containerName: "chainviz-lighthouse-1",
    clientType: "lighthouse",
    p2pRole: "bootnode",
  });

/** ノード追加ボタンをホバーしてツールチップ要素を返すヘルパー。 */
function hoverAddNode(name: RegExp = /ノードを追加/): HTMLElement {
  const addNodeButton = screen.getByRole("button", { name });
  fireEvent.mouseEnter(addNodeButton.parentElement as HTMLElement);
  return screen.getByRole("tooltip");
}

describe("add-node pair hint (Issue #251: why EL/CL is a pair)", () => {
  it("shows the second-line pair explanation alongside the existing generic hint", () => {
    renderToolbar();
    const tooltip = hoverAddNode();
    expect(tooltip.textContent).toContain(
      "2枚で1つのノードです。実行(EL)と合意(CL)を別々のクライアントが担うのは The Merge 以降の Ethereum の標準構成(",
    );
    expect(tooltip.textContent).toContain("EL/CL分離");
    expect(tooltip.textContent).toContain(")です");
  });

  it("shows the pair explanation even when a specific bootnode hint is resolvable", () => {
    // 2段目は静的な文言なので、1段目がブートノード解決済みの具体文言に
    // 変わっても常に付いてくる。
    renderToolbar({}, { entities: [elBoot(), clBoot()] });
    expect(hoverAddNode().textContent).toContain("EL/CL分離");
  });

  it("embeds a GlossaryTerm anchor (el-cl-separation) inside the pair explanation", () => {
    renderToolbar();
    hoverAddNode();
    const anchor = screen.getByTestId("glossary-term-el-cl-separation");
    expect(anchor).toBeTruthy();
    expect(anchor.textContent).toBe("EL/CL分離");
  });

  it("opens the glossary definition popover when hovering the nested EL/CL separation term without closing the outer hint", () => {
    // 設計メモ §3: ツールチップ内へマウスを移してもツールチップ自体が
    // 閉じないこと（ネストしたホバーの成立）を確認する。
    renderToolbar();
    const outerTooltip = hoverAddNode();
    expect(outerTooltip).toBeTruthy();

    const anchor = screen.getByTestId("glossary-term-el-cl-separation");
    fireEvent.mouseEnter(anchor);
    const definitionPopover = screen.getByTestId(
      "glossary-popover-el-cl-separation",
    );
    expect(definitionPopover.textContent).toContain(
      "実行クライアントと合意クライアントを分離する構成",
    );
    // 用語ポップオーバーを開いた後も、外側のツールチップ本体は残っている。
    expect(screen.getAllByRole("tooltip").length).toBeGreaterThanOrEqual(2);
  });

  describe("regression: the pair hint stays scoped to the add-node button", () => {
    it("does not add the pair explanation to the add-workbench hint", () => {
      renderToolbar();
      const addWorkbenchButton = screen.getByRole("button", {
        name: /ワークベンチを追加/,
      });
      fireEvent.mouseEnter(addWorkbenchButton.parentElement as HTMLElement);
      const tooltip = screen.getByRole("tooltip");
      expect(tooltip.textContent).not.toContain("EL/CL分離");
      expect(screen.queryByTestId("glossary-term-el-cl-separation")).toBeNull();
    });

    it("gives the add-node hint exactly one secondary (pair) line", () => {
      // Issue #251 は 2段目を span.action-hint__line--secondary として足す。
      renderToolbar();
      expect(
        hoverAddNode().querySelectorAll(".action-hint__line--secondary"),
      ).toHaveLength(1);
    });

    it("gives the add-workbench hint no secondary (pair) line", () => {
      // ワークベンチ側の既存ヒントは 2段目の構造を持たない（回帰の確認）。
      renderToolbar();
      const wrapper = screen.getByRole("button", {
        name: /ワークベンチを追加/,
      }).parentElement as HTMLElement;
      fireEvent.mouseEnter(wrapper);
      expect(
        screen
          .getByRole("tooltip")
          .querySelectorAll(".action-hint__line--secondary"),
      ).toHaveLength(0);
    });
  });

  describe("boundary: pair line is always present regardless of resolvable bootnodes", () => {
    it("keeps the pair explanation when entities is empty (generic first line)", () => {
      renderToolbar({}, { entities: [] });
      expect(hoverAddNode().textContent).toContain("EL/CL分離");
    });

    it("keeps the pair explanation when only a partial bootnode set is present (EL only, no CL)", () => {
      // 1段目のブートノード解決が中途半端でも、静的な2段目は落ちない。
      renderToolbar({}, { entities: [elBoot()] });
      expect(hoverAddNode().textContent).toContain("EL/CL分離");
    });
  });

  describe("language switching (Issue #251 requirement 4)", () => {
    it("shows the English pair explanation in English mode", () => {
      renderToolbar({}, {}, "en");
      const tooltip = hoverAddNode(/Add node/);
      expect(tooltip.textContent).toContain(
        "The two cards form one node — running execution (EL) and consensus (CL) as separate clients has been the standard shape of an Ethereum node since The Merge (",
      );
      expect(tooltip.textContent).toContain("EL/CL separation");
    });

    it("keeps the glossary anchor testid stable across languages while the label localizes", () => {
      // termKey は言語に依存しないため、英語モードでも同じ data-testid で
      // アンカーが引ける（ラベルだけが英語になる）。用語ポップオーバーへの
      // 導線が言語切り替えで壊れないことの確認。
      renderToolbar({}, {}, "en");
      hoverAddNode(/Add node/);
      const anchor = screen.getByTestId("glossary-term-el-cl-separation");
      expect(anchor.textContent).toBe("EL/CL separation");
    });

    it("opens the English glossary definition on nested hover in English mode", () => {
      renderToolbar({}, {}, "en");
      hoverAddNode(/Add node/);
      const anchor = screen.getByTestId("glossary-term-el-cl-separation");
      fireEvent.mouseEnter(anchor);
      expect(
        screen.getByTestId("glossary-popover-el-cl-separation").textContent,
      ).toContain("The split between execution and consensus clients");
    });
  });

  describe("nested hover independence (Issue #221 useHoverPopover)", () => {
    it("keeps the outer hint open when the cursor moves from the term back into the outer hint body", () => {
      // ActionHint と GlossaryTerm はそれぞれ独立した useHoverPopover を持つ。
      // 用語アンカーから外側ツールチップ本体へカーソルが戻る（relatedTarget が
      // 外側ツールチップ内を指す）場合、用語ポップオーバーの遅延クローズは
      // 予約されても外側のツールチップには波及しない。
      vi.useFakeTimers();
      try {
        renderToolbar();
        const outerTooltip = hoverAddNode();
        const anchor = screen.getByTestId("glossary-term-el-cl-separation");
        fireEvent.mouseEnter(anchor);
        expect(
          screen.getByTestId("glossary-popover-el-cl-separation"),
        ).toBeTruthy();

        // 用語から外側ツールチップ本体へ戻る。外側は leave しないので開いたまま。
        fireEvent.mouseLeave(anchor, { relatedTarget: outerTooltip });
        act(() => {
          vi.advanceTimersByTime(HOVER_POPOVER_CLOSE_DELAY_MS);
        });

        // 用語ポップオーバーは閉じたが、外側のツールチップは残っている。
        expect(
          screen.queryByTestId("glossary-popover-el-cl-separation"),
        ).toBeNull();
        expect(screen.getByRole("tooltip")).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
