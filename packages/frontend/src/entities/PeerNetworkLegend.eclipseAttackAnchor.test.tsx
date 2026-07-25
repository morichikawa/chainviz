// 攻撃手法解説の土台（ARCHITECTURE.md §17.4、Issue #413）: P2P凡例に添えた
// eclipseAttack 用語アンカーの表示確認。凡例の他の挙動（ネットワークごとの
// 行・discovery用語アンカー等）は PeerNetworkLegend.test.tsx が別途扱う
// （CLAUDE.md「1ファイル1責務」をテストファイルにも適用）。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { PeerFlowEdge } from "./peerEdge.js";
import { PeerNetworkLegend } from "./PeerNetworkLegend.js";

afterEach(cleanup);

const glossary: Glossary = {
  discovery: {
    key: "discovery",
    name: { ja: "ノード発見", en: "Node discovery" },
    definition: { ja: "発見の説明", en: "discovery definition" },
    layer: "b-network",
    relatedTerms: [],
  },
  eclipseAttack: {
    key: "eclipseAttack",
    name: { ja: "Eclipse攻撃", en: "Eclipse attack" },
    definition: { ja: "Eclipse攻撃の説明", en: "eclipse attack definition" },
    layer: "b-network",
    relatedTerms: [],
  },
};

function edge(id: string, networkId: string): PeerFlowEdge {
  return {
    id,
    source: `${id}-a`,
    target: `${id}-b`,
    type: "peer",
    data: { networkId },
  };
}

function wrap(edges: PeerFlowEdge[], lang: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={glossary}>
        <PeerNetworkLegend edges={edges} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("PeerNetworkLegend eclipse attack anchor (Issue #413)", () => {
  it("shows an eclipseAttack anchor in a second hint line", () => {
    wrap([edge("e1", "chainviz-ethereum-execution")]);
    expect(screen.getByTestId("p2p-legend-eclipse-hint")).toBeTruthy();
    expect(screen.getByTestId("glossary-term-eclipseAttack")).toBeTruthy();
  });

  it("localizes the eclipse hint to English without leaking Japanese characters", () => {
    const { container } = wrap([edge("e1", "chainviz-ethereum-execution")], "en");
    const hint = container.querySelector('[data-testid="p2p-legend-eclipse-hint"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent ?? "").toContain("eclipse attack");
    // ひらがな(3040-309f)・カタカナ(30a0-30ff)・CJK統合漢字(4e00-9fff)。
    expect(hint?.textContent ?? "").not.toMatch(/[぀-ヿ一-鿿]/);
  });

  it("does not render the eclipse hint when the legend itself is hidden (no peer edges)", () => {
    wrap([]);
    expect(screen.queryByTestId("p2p-legend-eclipse-hint")).toBeNull();
  });
});
