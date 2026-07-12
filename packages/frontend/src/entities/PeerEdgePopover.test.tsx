import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { Glossary } from "../glossary/types.js";
import { PeerEdgePopover } from "./PeerEdgePopover.js";

afterEach(cleanup);

const glossary: Glossary = {};

function wrap(
  networkId: string,
  endpoints: [string, string],
  lang: "ja" | "en" = "ja",
) {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={glossary}>
        <PeerEdgePopover networkId={networkId} endpoints={endpoints} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("PeerEdgePopover layer badge (Issue #299)", () => {
  it("shows the B-layer badge in the heading", () => {
    wrap("chainviz-ethereum-execution", ["reth1", "reth2"]);
    expect(screen.getByTestId("layer-badge-b")).toBeTruthy();
  });
});

describe("PeerEdgePopover", () => {
  it("shows the endpoints joined with the connector symbol", () => {
    wrap("chainviz-ethereum-execution", ["reth1", "reth2"]);
    expect(screen.getByText("reth1 ↔ reth2")).toBeTruthy();
  });

  it("shows the fixed 'this is normal' hint", () => {
    wrap("chainviz-ethereum-execution", ["reth1", "reth2"]);
    expect(
      screen.getByText(
        "ノード同士がノード発見で見つけ合って自動的につないだ接続です。線が時間差で増えたり、ノードごとに相手が違ったりするのは正常な動きです。",
      ),
    ).toBeTruthy();
  });

  it("has a tooltip role for accessibility", () => {
    wrap("chainviz-ethereum-execution", ["reth1", "reth2"]);
    expect(screen.getByRole("tooltip")).toBeTruthy();
  });

  it("renders only the connector when both endpoints are empty (defensive fallback)", () => {
    // PeerEdgeData.endpoints は optional で、防御的経路では ["", ""] が渡る。
    // 例外を投げず、区切り記号だけの表記になることを確認する。
    const { container } = wrap("chainviz-ethereum-execution", ["", ""]);
    expect(
      container.querySelector(".peer-popover__endpoints")?.textContent,
    ).toBe(" ↔ ");
  });

  it("shows the raw networkId (no glossary link) for an unknown network", () => {
    // 未知の networkId は NetworkLabel が生表示にフォールバックするため、
    // ポップオーバー内にも用語ボタンは出ない。
    wrap("some-other-chain-network", ["nodeA", "nodeB"]);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("some-other-chain-network")).toBeTruthy();
  });

  it("shows the English hint when the language is English", () => {
    wrap("chainviz-ethereum-execution", ["reth1", "reth2"], "en");
    expect(
      screen.getByText(
        "A connection the nodes established automatically after finding each other via node discovery. It is normal for cords to appear over time and for each node to have different peers.",
      ),
    ).toBeTruthy();
  });
});
