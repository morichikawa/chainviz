// チェーンリボンカードの学習用砂場メニュー内の「ロングレンジ攻撃を体験する」
// 入口(Issue #415→#430で単一メニューへ統合)が SidePanel を開くこと・
// SidePanelProvider が無い単体レンダーでも壊れないことの確認。メニュー自体の
// 開閉挙動は ChainRibbonCard.demoMenu.test.tsx が扱う(CLAUDE.md の1ファイル
// 1責務)。
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "../side-panel/SidePanelContext.js";
import { ChainRibbonCard } from "./ChainRibbonCard.js";
import type { ChainRibbonFlowNode } from "./chainRibbonNode.js";
import { RibbonHoverProvider } from "./RibbonHoverContext.js";

afterEach(cleanup);

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

function SidePanelViewProbe() {
  const { view } = useSidePanel();
  return <span data-testid="side-panel-view-kind">{view?.kind ?? "none"}</span>;
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
            <SidePanelViewProbe />
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
}

describe("ChainRibbonCard: long-range attack demo entry point (Issue #415, menu-integrated in #430)", () => {
  it("renders without a SidePanelProvider (no-op click, matching the other menu entries' pattern)", () => {
    render(
      <ReactFlowProvider>
        <LanguageProvider initialLanguage="ja">
          <GlossaryProvider glossary={{}}>
            <RibbonHoverProvider transactions={[]}>
              <ChainRibbonCard {...props()} />
            </RibbonHoverProvider>
          </GlossaryProvider>
        </LanguageProvider>
      </ReactFlowProvider>,
    );
    fireEvent.click(screen.getByTestId("chain-ribbon-demo-menu-open"));
    const button = screen.getByTestId("chain-ribbon-long-range-demo-open");
    expect(() => fireEvent.click(button)).not.toThrow();
  });

  it("exposes the entry as a real <button> with an accessible name once the menu is open", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("chain-ribbon-demo-menu-open"));
    const button = screen.getByRole("button", { name: "ロングレンジ攻撃を体験する" });
    expect(button.tagName).toBe("BUTTON");
    expect((button as HTMLButtonElement).type).toBe("button");
  });

  it("opens the longRangeAttackDemo side panel view when clicked, and closes the menu", () => {
    renderCard();
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("none");
    fireEvent.click(screen.getByTestId("chain-ribbon-demo-menu-open"));
    fireEvent.click(screen.getByTestId("chain-ribbon-long-range-demo-open"));
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("longRangeAttackDemo");
    expect(
      screen.getByTestId("chain-ribbon-demo-menu-open").closest("details")?.hasAttribute("open"),
    ).toBe(false);
  });

  it("keeps all three sandbox entries independent (hash / 51% / long-range)", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("chain-ribbon-demo-menu-open"));
    expect(screen.getByTestId("chain-ribbon-hash-demo-open")).toBeTruthy();
    expect(screen.getByTestId("chain-ribbon-fifty-one-percent-demo-open")).toBeTruthy();

    fireEvent.click(screen.getByTestId("chain-ribbon-long-range-demo-open"));
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("longRangeAttackDemo");

    fireEvent.click(screen.getByTestId("chain-ribbon-demo-menu-open"));
    fireEvent.click(screen.getByTestId("chain-ribbon-hash-demo-open"));
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("hashChainDemo");
  });
});
