import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { Glossary } from "../glossary/types.js";
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

describe("PeerNetworkLegend", () => {
  it("renders nothing when there are no peer edges", () => {
    const { container } = wrap([]);
    expect(container.querySelector(".p2p-legend")).toBeNull();
  });

  it("groups edges by networkId and shows a count per network", () => {
    wrap([
      edge("e1", "chainviz-ethereum-execution"),
      edge("e2", "chainviz-ethereum-execution"),
      edge("e3", "chainviz-ethereum-consensus"),
    ]);
    expect(
      screen.getByTestId("p2p-legend-count-chainviz-ethereum-execution")
        .textContent,
    ).toBe("2");
    expect(
      screen.getByTestId("p2p-legend-count-chainviz-ethereum-consensus")
        .textContent,
    ).toBe("1");
  });

  it("shows the fixed hint with the discovery term wrapped", () => {
    wrap([edge("e1", "chainviz-ethereum-execution")]);
    const legend = screen.getByTestId("p2p-legend");
    expect(legend.textContent).toContain("ノード発見");
    expect(legend.textContent).toContain("自動で増えます");
  });

  it("shows a single network with a count of 1 (boundary: one edge)", () => {
    wrap([edge("e1", "chainviz-ethereum-consensus")]);
    expect(
      screen.getByTestId("p2p-legend-count-chainviz-ethereum-consensus")
        .textContent,
    ).toBe("1");
    // 1ネットワークだけのときは行が1つ（複数の networkId 行が出ない）。
    expect(
      screen.getAllByText(/./, { selector: ".p2p-legend__count" }),
    ).toHaveLength(1);
  });

  it("renders one row per networkId when many distinct networks exist", () => {
    const many = Array.from({ length: 12 }, (_, i) =>
      edge(`e${i}`, `net-${i}`),
    );
    wrap(many);
    for (let i = 0; i < 12; i += 1) {
      expect(
        screen.getByTestId(`p2p-legend-count-net-${i}`).textContent,
      ).toBe("1");
    }
    expect(
      screen.getAllByText(/./, { selector: ".p2p-legend__count" }),
    ).toHaveLength(12);
  });

  it("preserves first-seen network order across rows", () => {
    // groupEdgesByNetwork は Map の挿入順を保つ。凡例の行順もそれに従う。
    wrap([
      edge("e1", "chainviz-ethereum-consensus"),
      edge("e2", "chainviz-ethereum-execution"),
      edge("e3", "chainviz-ethereum-consensus"),
    ]);
    const counts = screen.getAllByText(/./, {
      selector: ".p2p-legend__count",
    });
    // consensus が先に現れたので consensus 行が先。
    expect(
      screen.getByTestId("p2p-legend-count-chainviz-ethereum-consensus")
        .textContent,
    ).toBe("2");
    expect(counts[0].getAttribute("data-testid")).toBe(
      "p2p-legend-count-chainviz-ethereum-consensus",
    );
  });

  it("renders a raw name for an unknown networkId without crashing", () => {
    wrap([edge("e1", "1337")]);
    expect(screen.getByTestId("p2p-legend-count-1337").textContent).toBe("1");
    expect(screen.getByText("1337")).toBeTruthy();
  });

  it("handles an edge whose data/networkId is missing (empty-string bucket)", () => {
    // data 無しの防御的エッジは "" ネットワークに落ちる。行は出るが例外は投げない。
    const noData = { id: "e1", source: "a", target: "b", type: "peer" } as
      unknown as PeerFlowEdge;
    wrap([noData]);
    expect(screen.getByTestId("p2p-legend-count-").textContent).toBe("1");
  });

  it("localizes the hint to English", () => {
    wrap([edge("e1", "chainviz-ethereum-execution")], "en");
    const legend = screen.getByTestId("p2p-legend");
    expect(legend.textContent).toContain("Peer connections grow over time via");
    expect(legend.textContent).toContain("node discovery");
    // Issue #341: legend.hint.suffix の en は意図的な空文字。ja へフォール
    // バックして日本語断片が混入してはならない。
    expect(legend.textContent).not.toContain("により時間とともに自動で増えます");
  });
});
