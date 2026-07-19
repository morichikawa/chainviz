// SidePanelHost の signatureDemo kind への振り分け(Issue #402)。
// contractSource kind のダングリングガードは対象外(SidePanelHost.test.tsx
// が担う)。ここでは kind の振り分け・排他制御だけを確認する
// (デモ本体の操作フローは crypto-demo/SignatureDemoView.test.tsx が扱う。
// CLAUDE.md のテスト分割方針。#401 の SidePanelHost.hashChainDemo.test.tsx
// と同型)。
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
        data-testid="trigger-sig-demo"
        onClick={() => open({ kind: "signatureDemo" })}
      >
        open signatureDemo
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

describe("SidePanelHost: signatureDemo kind (Issue #402)", () => {
  it("renders the signature demo panel with a localized title", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-sig-demo"));
    expect(screen.getByTestId("side-panel")).toBeTruthy();
    expect(screen.getByTestId("signature-demo")).toBeTruthy();
    expect(screen.getByText("署名と検証のしくみ")).toBeTruthy();
  });

  it("is exclusive with contractSource: opening the demo replaces an open contract source panel", () => {
    const target = contract({ name: "ChainvizToken" });
    renderHost(new Map([[target.address, target]]));
    fireEvent.click(screen.getByTestId("trigger-contract-source"));
    expect(screen.getByTestId("contract-source-view")).toBeTruthy();

    fireEvent.click(screen.getByTestId("trigger-sig-demo"));
    expect(screen.queryByTestId("contract-source-view")).toBeNull();
    expect(screen.getByTestId("signature-demo")).toBeTruthy();
  });

  it("is exclusive with the hashChainDemo kind (only one panel at a time)", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-hash-demo"));
    expect(screen.getByTestId("hash-chain-demo")).toBeTruthy();

    fireEvent.click(screen.getByTestId("trigger-sig-demo"));
    expect(screen.queryByTestId("hash-chain-demo")).toBeNull();
    expect(screen.getByTestId("signature-demo")).toBeTruthy();
  });

  it("is not affected by the contractSource dangling guard (no target entity of its own)", () => {
    renderHost(new Map());
    fireEvent.click(screen.getByTestId("trigger-sig-demo"));
    expect(screen.getByTestId("signature-demo")).toBeTruthy();
    expect(screen.getByTestId("side-panel")).toBeTruthy();
  });

  it("starts fresh each time it is reopened (state does not leak across kind switches)", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-sig-demo"));

    fireEvent.change(screen.getByTestId("signature-demo-received-amount"), {
      target: { value: "999" },
    });
    expect(screen.getByTestId("signature-demo-badge").textContent).toContain("無効");

    fireEvent.click(screen.getByTestId("trigger-hash-demo"));
    expect(screen.queryByTestId("signature-demo")).toBeNull();
    fireEvent.click(screen.getByTestId("trigger-sig-demo"));

    expect(screen.getByTestId("signature-demo-badge").textContent).toContain("有効: 復元されたアドレスが送信者と一致");
    expect(
      (screen.getByTestId("signature-demo-received-amount") as HTMLInputElement).value,
    ).toBe("1");
  });
});
