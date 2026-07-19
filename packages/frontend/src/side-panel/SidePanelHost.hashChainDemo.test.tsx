// SidePanelHost の hashChainDemo kind への振り分け(Issue #401)。
// contractSource kind のダングリングガードは対象外(SidePanelHost.test.tsx
// が担う)。ここでは kind の振り分け・排他制御だけを確認する
// (デモ本体の操作フローは crypto-demo/HashChainDemoView.test.tsx が扱う。
// CLAUDE.md のテスト分割方針)。
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
      <button
        type="button"
        data-testid="trigger-glossary"
        onClick={() => open({ kind: "glossary" })}
      >
        open glossary
      </button>
      <button
        type="button"
        data-testid="trigger-comms-log"
        onClick={() => open({ kind: "commsLog" })}
      >
        open commsLog
      </button>
    </>
  );
}

function renderHost(contractsByAddress: Map<string, ContractEntity> = new Map()) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
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

describe("SidePanelHost: hashChainDemo kind (Issue #401)", () => {
  it("renders the hash chain demo panel with a localized title", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-hash-demo"));
    expect(screen.getByTestId("side-panel")).toBeTruthy();
    expect(screen.getByTestId("hash-chain-demo")).toBeTruthy();
    expect(screen.getByText("ハッシュのしくみ")).toBeTruthy();
  });

  it("is exclusive with contractSource: opening the demo replaces an open contract source panel", () => {
    const target = contract({ name: "ChainvizToken" });
    renderHost(new Map([[target.address, target]]));
    fireEvent.click(screen.getByTestId("trigger-contract-source"));
    expect(screen.getByTestId("contract-source-view")).toBeTruthy();

    fireEvent.click(screen.getByTestId("trigger-hash-demo"));
    expect(screen.queryByTestId("contract-source-view")).toBeNull();
    expect(screen.getByTestId("hash-chain-demo")).toBeTruthy();
  });

  it("is exclusive the other way: opening contractSource replaces an open demo panel", () => {
    const target = contract({ name: "ChainvizToken" });
    renderHost(new Map([[target.address, target]]));
    fireEvent.click(screen.getByTestId("trigger-hash-demo"));
    expect(screen.getByTestId("hash-chain-demo")).toBeTruthy();

    fireEvent.click(screen.getByTestId("trigger-contract-source"));
    expect(screen.queryByTestId("hash-chain-demo")).toBeNull();
    expect(screen.getByTestId("contract-source-view")).toBeTruthy();
  });

  it("is not affected by the contractSource dangling guard (no target entity of its own)", () => {
    // hashChainDemo は world state のエンティティを一切参照しないため、
    // contractsByAddress が空でもダングリングとして閉じてはならない
    // (commsLog/glossary と同型の回帰確認)。
    renderHost(new Map());
    fireEvent.click(screen.getByTestId("trigger-hash-demo"));
    expect(screen.getByTestId("hash-chain-demo")).toBeTruthy();
    expect(screen.getByTestId("side-panel")).toBeTruthy();
  });

  it("is exclusive with the glossary and commsLog kinds (only one panel at a time)", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-glossary"));
    fireEvent.click(screen.getByTestId("trigger-hash-demo"));
    expect(screen.getByTestId("hash-chain-demo")).toBeTruthy();

    // demo → commsLog へ切り替えると demo は消える。
    fireEvent.click(screen.getByTestId("trigger-comms-log"));
    expect(screen.queryByTestId("hash-chain-demo")).toBeNull();

    // commsLog → demo へ戻すと demo だけが表示される（混線しない）。
    fireEvent.click(screen.getByTestId("trigger-hash-demo"));
    expect(screen.getByTestId("hash-chain-demo")).toBeTruthy();
    expect(screen.getAllByTestId("hash-chain-demo").length).toBe(1);
  });

  it("starts fresh each time it is reopened (state does not leak across kind switches)", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-hash-demo"));

    // #1 のデータを改ざん → #2 が無効になる。
    fireEvent.change(screen.getByTestId("hash-chain-demo-data-1"), {
      target: { value: "tampered" },
    });
    expect(screen.getByTestId("hash-chain-demo-badge-2").textContent).toContain("無効");

    // 別 kind へ切り替えてデモをアンマウントし、開き直す。
    fireEvent.click(screen.getByTestId("trigger-glossary"));
    expect(screen.queryByTestId("hash-chain-demo")).toBeNull();
    fireEvent.click(screen.getByTestId("trigger-hash-demo"));

    // 開き直したら初期状態（全ブロック有効・改ざん内容は残らない）から始まる。
    expect(screen.getByTestId("hash-chain-demo-badge-2").textContent).toBe("有効");
    expect((screen.getByTestId("hash-chain-demo-data-1") as HTMLInputElement).value).toBe(
      "Alice → Bob: 5 ETH",
    );
  });
});
