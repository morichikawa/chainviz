// SidePanelHost の longRangeAttackDemo kind への振り分け(Issue #415)。
// contractSource kind のダングリングガードは対象外(SidePanelHost.test.tsx
// が担う)。ここでは kind の振り分け・排他制御・タイトルの用語アンカーだけを
// 確認する(デモ本体の操作フローは
// attack-demo/LongRangeAttackDemoView.test.tsx が扱う。CLAUDE.md の
// テスト分割方針)。
import type { ContractEntity } from "@chainviz/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "./SidePanelContext.js";
import { SidePanelHost } from "./SidePanelHost.js";

afterEach(cleanup);

const CONTRACT_ADDRESS = `0x${"e".repeat(40)}`;

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: CONTRACT_ADDRESS,
    chainType: "ethereum",
    ...overrides,
  };
}

function OpenButtons() {
  const { open } = useSidePanel();
  return (
    <>
      <button
        type="button"
        data-testid="trigger-long-range-demo"
        onClick={() => open({ kind: "longRangeAttackDemo" })}
      >
        open longRangeAttackDemo
      </button>
      <button
        type="button"
        data-testid="trigger-hash-demo"
        onClick={() => open({ kind: "hashChainDemo" })}
      >
        open hashChainDemo
      </button>
      <button
        type="button"
        data-testid="trigger-contract-source"
        onClick={() => open({ kind: "contractSource", address: CONTRACT_ADDRESS })}
      >
        open contractSource
      </button>
    </>
  );
}

function renderHost(contractsByAddress: Map<string, ContractEntity> = new Map()) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider
        glossary={{
          longRangeAttack: {
            key: "longRangeAttack",
            name: { ja: "ロングレンジ攻撃", en: "Long-range attack" },
            definition: { ja: "過去に遡って別の履歴を作り直す攻撃", en: "Rewriting past history" },
            layer: "b-network",
            relatedTerms: [],
          },
        }}
      >
        <SidePanelProvider>
          <OpenButtons />
          <SidePanelHost
            contractsByAddress={contractsByAddress}
            commsLog={{
              visibleEntries: [],
              filters: { categories: {} as never, nodeId: null },
              toggleCategory: () => {},
              setNodeFilter: () => {},
            }}
            commsLogNodeOptions={[]}
            layerFilter="all"
            onLayerFilterChange={() => {}}
          />
        </SidePanelProvider>
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("SidePanelHost: longRangeAttackDemo kind (Issue #415)", () => {
  it("renders the long-range attack demo panel with a localized, term-anchored title", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-long-range-demo"));
    expect(screen.getByTestId("side-panel")).toBeTruthy();
    expect(screen.getByTestId("long-range-demo")).toBeTruthy();
    // タイトル文字列自体はそのまま表示される（GlossaryTerm アンカーが
    // 部分文字列を <span> で分割するため、textContent の完全一致で判定する。
    // HashChainBlockRow.i18n.test.tsx 等と同じ流儀）。
    expect(
      screen.getAllByText(
        (_, element) => element?.textContent === "ロングレンジ攻撃のしくみ",
      ).length,
    ).toBeGreaterThanOrEqual(1);
    // §7: タイトル中の「ロングレンジ攻撃」に用語集アンカーが付いている
    // （checkpoint 初期値 = 0 の時点で #0 の確定済みバッジにも同じ用語への
    // アンカーがあるため、複数ヒットになる。個別の内訳は
    // LongRangeAttackDemoView.glossaryAnchor.test.tsx が扱う）。
    expect(
      screen.getAllByTestId("glossary-term-longRangeAttack").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("is exclusive with contractSource: opening the demo replaces an open contract source panel", () => {
    const target = contract({ name: "ChainvizToken" });
    renderHost(new Map([[target.address, target]]));
    fireEvent.click(screen.getByTestId("trigger-contract-source"));
    expect(screen.getByTestId("contract-source-view")).toBeTruthy();

    fireEvent.click(screen.getByTestId("trigger-long-range-demo"));
    expect(screen.queryByTestId("contract-source-view")).toBeNull();
    expect(screen.getByTestId("long-range-demo")).toBeTruthy();
  });

  it("is exclusive with the other sandbox demo (hashChainDemo)", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-hash-demo"));
    expect(screen.getByTestId("hash-chain-demo")).toBeTruthy();

    fireEvent.click(screen.getByTestId("trigger-long-range-demo"));
    expect(screen.queryByTestId("hash-chain-demo")).toBeNull();
    expect(screen.getByTestId("long-range-demo")).toBeTruthy();
  });

  it("is not affected by the contractSource dangling guard (no target entity of its own)", () => {
    renderHost(new Map());
    fireEvent.click(screen.getByTestId("trigger-long-range-demo"));
    expect(screen.getByTestId("long-range-demo")).toBeTruthy();
    expect(screen.getByTestId("side-panel")).toBeTruthy();
  });

  it("starts fresh each time it is reopened (checkpoint does not leak across kind switches)", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-long-range-demo"));
    fireEvent.click(screen.getByTestId("long-range-demo-checkpoint-3"));
    expect(
      screen.getByTestId("long-range-demo-checkpoint-3").getAttribute("aria-pressed"),
    ).toBe("true");

    // 別 kind へ切り替えてデモをアンマウントし、開き直す。
    fireEvent.click(screen.getByTestId("trigger-hash-demo"));
    expect(screen.queryByTestId("long-range-demo")).toBeNull();
    fireEvent.click(screen.getByTestId("trigger-long-range-demo"));

    // 開き直したら初期状態（checkpoint = 0）から始まる。
    expect(
      screen.getByTestId("long-range-demo-checkpoint-0").getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
