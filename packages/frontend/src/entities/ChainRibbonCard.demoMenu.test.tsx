// チェーンリボンカードの学習用砂場メニュー(Issue #414。
// `docs/worklog/issue-414.md` UX設計 §4。Issue #430でロングレンジ攻撃デモも
// このメニューへ統合)の開閉挙動そのものの確認。個々の入口ボタン
// (ハッシュのしくみ・51%攻撃・ロングレンジ攻撃)のクリック挙動は
// ChainRibbonCard.hashDemoEntry.test.tsx / .attack51DemoEntry.test.tsx /
// .longRangeDemoEntry.test.tsx が扱う(CLAUDE.md の1ファイル1責務)。
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider } from "../side-panel/SidePanelContext.js";
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

describe("ChainRibbonCard: learning sandbox menu (Issue #414)", () => {
  it("is closed by default", () => {
    renderCard();
    const details = screen.getByTestId("chain-ribbon-demo-menu-open").closest("details");
    expect(details?.hasAttribute("open")).toBe(false);
  });

  it("opens when the summary is clicked and lists all three sandbox entries", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("chain-ribbon-demo-menu-open"));
    const details = screen.getByTestId("chain-ribbon-demo-menu-open").closest("details");
    expect(details?.hasAttribute("open")).toBe(true);
    expect(screen.getByTestId("chain-ribbon-hash-demo-open")).toBeTruthy();
    expect(screen.getByTestId("chain-ribbon-fifty-one-percent-demo-open")).toBeTruthy();
    expect(screen.getByTestId("chain-ribbon-long-range-demo-open")).toBeTruthy();
  });

  it("closes again when the summary is clicked a second time", () => {
    renderCard();
    const summary = screen.getByTestId("chain-ribbon-demo-menu-open");
    fireEvent.click(summary);
    expect(summary.closest("details")?.hasAttribute("open")).toBe(true);
    fireEvent.click(summary);
    expect(summary.closest("details")?.hasAttribute("open")).toBe(false);
  });

  it("closes the menu after opening the 51% attack demo from it", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("chain-ribbon-demo-menu-open"));
    fireEvent.click(screen.getByTestId("chain-ribbon-fifty-one-percent-demo-open"));
    expect(
      screen.getByTestId("chain-ribbon-demo-menu-open").closest("details")?.hasAttribute("open"),
    ).toBe(false);
  });

  it("closes the menu after opening the long-range attack demo from it (Issue #430)", () => {
    renderCard();
    fireEvent.click(screen.getByTestId("chain-ribbon-demo-menu-open"));
    fireEvent.click(screen.getByTestId("chain-ribbon-long-range-demo-open"));
    expect(
      screen.getByTestId("chain-ribbon-demo-menu-open").closest("details")?.hasAttribute("open"),
    ).toBe(false);
  });
});
