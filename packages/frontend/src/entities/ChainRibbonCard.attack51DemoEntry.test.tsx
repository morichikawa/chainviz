// チェーンリボンカードの学習用砂場メニュー内の「51%攻撃のしくみを試す」
// 入口(Issue #414)が SidePanel を開くこと・SidePanelProvider が無い単体
// レンダーでも壊れないことの確認。メニュー自体の開閉挙動は
// ChainRibbonCard.demoMenu.test.tsx が扱う(CLAUDE.md の1ファイル1責務)。
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

describe("ChainRibbonCard: 51% attack demo entry point (Issue #414)", () => {
  it("renders without a SidePanelProvider (no-op click, matching GlossaryTerm's optional pattern)", () => {
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
    const button = screen.getByTestId("chain-ribbon-fifty-one-percent-demo-open");
    expect(() => fireEvent.click(button)).not.toThrow();
  });

  it("exposes the entry as a real <button> with an accessible name once the menu is open", () => {
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
    const button = screen.getByRole("button", { name: "51%攻撃のしくみを試す" });
    expect(button.tagName).toBe("BUTTON");
    expect((button as HTMLButtonElement).type).toBe("button");
  });

  it("opens the fiftyOnePercentAttackDemo side panel view when clicked", () => {
    render(
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
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("none");
    fireEvent.click(screen.getByTestId("chain-ribbon-demo-menu-open"));
    fireEvent.click(screen.getByTestId("chain-ribbon-fifty-one-percent-demo-open"));
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe(
      "fiftyOnePercentAttackDemo",
    );
  });
});
