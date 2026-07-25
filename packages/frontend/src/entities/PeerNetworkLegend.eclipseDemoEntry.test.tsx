// PeerNetworkLegend の「eclipse攻撃のしくみを試す」入口ボタン（Issue #416）
// が SidePanel を開くこと・SidePanelProvider が無い単体レンダーでも壊れない
// ことの確認。凡例の他の挙動（ネットワーク別行・ヒント文等）は
// PeerNetworkLegend.test.tsx が扱う（CLAUDE.md の1ファイル1責務。
// TxLifecyclePopover.sigDemoEntry.test.tsx と同型）。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "../side-panel/SidePanelContext.js";
import type { PeerFlowEdge } from "./peerEdge.js";
import { PeerNetworkLegend } from "./PeerNetworkLegend.js";

afterEach(cleanup);

function edge(id: string, networkId: string): PeerFlowEdge {
  return {
    id,
    source: `${id}-a`,
    target: `${id}-b`,
    type: "peer",
    data: { networkId },
  };
}

function SidePanelViewProbe() {
  const { view } = useSidePanel();
  return <span data-testid="side-panel-view-kind">{view?.kind ?? "none"}</span>;
}

describe("PeerNetworkLegend: eclipse attack demo entry (Issue #416)", () => {
  it("renders without a SidePanelProvider (no-op click)", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <PeerNetworkLegend edges={[edge("e1", "chainviz-ethereum-execution")]} />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    const button = screen.getByTestId("p2p-legend-eclipse-demo-open");
    expect(() => fireEvent.click(button)).not.toThrow();
  });

  it("exposes the entry as a real <button> with an accessible name (keyboard reachable)", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <PeerNetworkLegend edges={[edge("e1", "chainviz-ethereum-execution")]} />
        </GlossaryProvider>
      </LanguageProvider>,
    );
    const button = screen.getByRole("button", { name: "eclipse攻撃のしくみを試す" });
    expect(button.tagName).toBe("BUTTON");
    expect((button as HTMLButtonElement).type).toBe("button");
  });

  it("opens the eclipseAttackDemo side panel view when clicked", () => {
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <SidePanelProvider>
            <PeerNetworkLegend edges={[edge("e1", "chainviz-ethereum-execution")]} />
            <SidePanelViewProbe />
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("none");
    fireEvent.click(screen.getByTestId("p2p-legend-eclipse-demo-open"));
    expect(screen.getByTestId("side-panel-view-kind").textContent).toBe("eclipseAttackDemo");
  });
});
