// 攻撃手法解説の土台（ARCHITECTURE.md §17.4、Issue #413）: P2P凡例に添えた
// eclipseAttack 用語アンカーの表示確認。凡例の他の挙動（ネットワークごとの
// 行・discovery用語アンカー等）は PeerNetworkLegend.test.tsx が別途扱う
// （CLAUDE.md「1ファイル1責務」をテストファイルにも適用）。
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { messages } from "../i18n/messages.js";
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

function wrap(
  edges: PeerFlowEdge[],
  lang: "ja" | "en" = "ja",
  glossaryOverride?: Glossary,
) {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={glossaryOverride ?? glossary}>
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

  it("keeps the eclipse hint as the last line, after the existing discovery hint", () => {
    // 既存ヒント（ノード発見）の2行目として添える設計（Issue #413 設計メモ
    // §4）。順序が入れ替わると「まず正常な動きを説明し、その裏返しとして
    // 攻撃を示す」という説明の流れが崩れる。
    wrap([edge("e1", "chainviz-ethereum-execution")]);
    const hints = [
      ...screen.getByTestId("p2p-legend").querySelectorAll<HTMLElement>(".p2p-legend__hint"),
    ];
    expect(hints).toHaveLength(2);
    expect(hints[0].textContent ?? "").toContain("ノード発見");
    expect(hints[1].dataset.testid).toBe("p2p-legend-eclipse-hint");
  });

  it("shows the eclipse hint once even when several networks are listed", () => {
    // 凡例の行はネットワークごとに増えるが、ヒントは凡例全体に1つ。
    wrap([
      edge("e1", "chainviz-ethereum-execution"),
      edge("e2", "chainviz-ethereum-consensus"),
    ]);
    expect(screen.getAllByTestId("p2p-legend-eclipse-hint")).toHaveLength(1);
    expect(screen.getAllByTestId("glossary-term-eclipseAttack")).toHaveLength(1);
  });

  it("keeps the hint sentence readable when the glossary lacks eclipseAttack", () => {
    // 用語エントリが読み飛ばされても、アンカーには表示テキスト（children）を
    // 渡しているため文としては崩れない（生キーが露出しない）。
    wrap([edge("e1", "chainviz-ethereum-execution")], "ja", {});
    const hint = screen.getByTestId("p2p-legend-eclipse-hint");
    expect(hint.textContent ?? "").toContain("Eclipse攻撃");
    expect(hint.textContent ?? "").not.toContain("eclipseAttack");
    expect(screen.queryByTestId("glossary-term-eclipseAttack")).toBeNull();
  });

  it("composes the ja hint as prefix + anchor + suffix in that order", () => {
    // prefix/term/suffix の3分割（Issue #341 の legend.hint と同型）が
    // 1文として繋がっていること。文言自体の整合は
    // i18n.attackHintTrios.test.ts が見るため、ここでは「3つを順に並べた
    // 結果がそのまま描画される」ことだけを固定する。
    wrap([edge("e1", "chainviz-ethereum-execution")]);
    const hint = screen.getByTestId("p2p-legend-eclipse-hint");
    expect(hint.textContent ?? "").toBe(
      messages["legend.eclipseHint.prefix"].ja +
        messages["legend.eclipseHint.term"].ja +
        messages["legend.eclipseHint.suffix"].ja,
    );
  });
});
