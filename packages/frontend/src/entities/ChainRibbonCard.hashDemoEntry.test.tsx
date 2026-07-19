// チェーンリボンカードの常設入口(subtitle 行末の「ハッシュのしくみを試す」
// ボタン。Issue #401)が SidePanel を開くこと・SidePanelProvider が無い
// 単体レンダーでも壊れないことの確認。カード自体の他の挙動は
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

/** パネルが開いた状態を観測するためのプローブ。 */
function SidePanelViewProbe() {
  const { view } = useSidePanel();
  return <span data-testid="side-panel-view-kind">{view?.kind ?? "none"}</span>;
}

describe("ChainRibbonCard: hash chain demo entry point (Issue #401)", () => {
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
    const button = screen.getByTestId("chain-ribbon-hash-demo-open");
    expect(() => fireEvent.click(button)).not.toThrow();
  });

  it("exposes the entry as a real <button> with an accessible name (keyboard reachable)", () => {
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
    // アクセシブル名（見出しテキスト）を持つ <button> = Tab で到達し
    // Enter/Space で起動できる。専用の aria-label は不要（テキストが名になる）。
    const button = screen.getByRole("button", { name: "ハッシュのしくみを試す" });
    expect(button.tagName).toBe("BUTTON");
    expect((button as HTMLButtonElement).type).toBe("button");
  });

  it("opens the hashChainDemo side panel view when clicked", () => {
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
    fireEvent.click(screen.getByTestId("chain-ribbon-hash-demo-open"));
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("hashChainDemo");
  });
});
