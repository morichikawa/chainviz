// チェーンリボンカードの「攻撃を学ぶ」入口行(Issue #415。既存 subtitle-row
// とは別の新規行)が SidePanel を開くこと・SidePanelProvider が無い単体
// レンダーでも壊れないことの確認。カード自体の他の挙動は
// ChainRibbonCard.test.tsx が扱う(CLAUDE.md の1ファイル1責務)。
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
          <RibbonHoverProvider transactions={[]}>
            <ChainRibbonCard {...props()} />
          </RibbonHoverProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
}

describe("ChainRibbonCard: long-range attack demo entry point (Issue #415)", () => {
  it("renders without a SidePanelProvider (no-op click, matching the hash demo entry's pattern)", () => {
    renderCard();
    const button = screen.getByTestId("chain-ribbon-long-range-demo-open");
    expect(() => fireEvent.click(button)).not.toThrow();
  });

  it("exposes the entry as a real <button> with an accessible name (keyboard reachable)", () => {
    renderCard();
    const button = screen.getByRole("button", { name: "ロングレンジ攻撃を体験する" });
    expect(button.tagName).toBe("BUTTON");
    expect((button as HTMLButtonElement).type).toBe("button");
  });

  it("opens the longRangeAttackDemo side panel view when clicked", () => {
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
    fireEvent.click(screen.getByTestId("chain-ribbon-long-range-demo-open"));
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("longRangeAttackDemo");
  });

  it("keeps the hash demo entry (subtitle-row) and the attack-demo-row entry both present and independent", () => {
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
    expect(screen.getByTestId("chain-ribbon-hash-demo-open")).toBeTruthy();
    fireEvent.click(screen.getByTestId("chain-ribbon-long-range-demo-open"));
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("longRangeAttackDemo");
    fireEvent.click(screen.getByTestId("chain-ribbon-hash-demo-open"));
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("hashChainDemo");
  });
});
