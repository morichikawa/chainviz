import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { Glossary } from "../glossary/types.js";
import { NetworkLabel } from "./NetworkLabel.js";

afterEach(cleanup);

const glossary: Glossary = {
  "execution-p2p": {
    key: "execution-p2p",
    name: { ja: "実行層P2Pネットワーク", en: "Execution P2P network" },
    definition: { ja: "実行層の説明", en: "Execution P2P definition" },
    layer: "b-network",
    relatedTerms: [],
  },
  "consensus-p2p": {
    key: "consensus-p2p",
    name: { ja: "合意層P2Pネットワーク", en: "Consensus P2P network" },
    definition: { ja: "合意層の説明", en: "Consensus P2P definition" },
    layer: "b-network",
    relatedTerms: [],
  },
};

function wrap(networkId: string, lang: "ja" | "en" = "ja") {
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={glossary}>
        <NetworkLabel networkId={networkId} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("NetworkLabel", () => {
  it("wraps a known Ethereum execution networkId with a GlossaryTerm", () => {
    wrap("chainviz-ethereum-execution");
    expect(screen.getByRole("button").textContent).toBe("実行ネットワーク");
  });

  it("wraps a known Ethereum consensus networkId with a GlossaryTerm", () => {
    wrap("chainviz-ethereum-consensus");
    expect(screen.getByRole("button").textContent).toBe("コンセンサスネットワーク");
  });

  it("falls back to the raw networkId for an unrecognized network", () => {
    wrap("some-other-chain-network");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("some-other-chain-network")).toBeTruthy();
  });

  it("renders a color chip", () => {
    const { container } = wrap("chainviz-ethereum-execution");
    expect(container.querySelector(".network-label__chip")).toBeTruthy();
  });

  it("falls back to the raw networkId for an uppercased suffix (case-sensitive)", () => {
    // describeNetwork は大文字接尾辞を既知扱いしないので GlossaryTerm で
    // 包まず、networkId をそのまま表示する。
    wrap("chainviz-ethereum-EXECUTION");
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("chainviz-ethereum-EXECUTION")).toBeTruthy();
  });

  it("renders an empty raw name for the empty networkId without crashing", () => {
    const { container } = wrap("");
    expect(screen.queryByRole("button")).toBeNull();
    // 色チップは出るが名前は空文字（例外を投げない）。
    expect(container.querySelector(".network-label__chip")).toBeTruthy();
    expect(container.querySelector(".network-label__name")?.textContent).toBe("");
  });

  it("uses the English label for a known network when the language is English", () => {
    wrap("chainviz-ethereum-execution", "en");
    expect(screen.getByRole("button").textContent).toBe("Execution network");
  });

  it("classifies a networkId that ends with -consensus even if 'execution' appears earlier", () => {
    // 末尾の接尾辞が優先されることを UI レベルでも固定する。
    wrap("execution-consensus");
    expect(screen.getByRole("button").textContent).toBe("コンセンサスネットワーク");
  });
});
