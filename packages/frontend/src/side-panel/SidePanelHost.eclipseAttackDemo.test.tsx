// SidePanelHost の eclipseAttackDemo kind への振り分け(Issue #416)。
// contractSource kind のダングリングガードは対象外(SidePanelHost.test.tsx
// が担う)。ここでは kind の振り分け・排他制御だけを確認する
// (デモ本体の操作フローは attack-demo/EclipseAttackDemoView.test.tsx が扱う。
// CLAUDE.md のテスト分割方針。SidePanelHost.hashChainDemo.test.tsx と同型)。
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
        data-testid="trigger-eclipse-demo"
        onClick={() => open({ kind: "eclipseAttackDemo" })}
      >
        open eclipseAttackDemo
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

describe("SidePanelHost: eclipseAttackDemo kind (Issue #416)", () => {
  it("renders the eclipse attack demo panel with a localized title", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-eclipse-demo"));
    expect(screen.getByTestId("side-panel")).toBeTruthy();
    expect(screen.getByTestId("eclipse-demo")).toBeTruthy();
    expect(screen.getByText("eclipse攻撃のしくみ")).toBeTruthy();
  });

  it("is exclusive with contractSource: opening the demo replaces an open contract source panel", () => {
    const target = contract({ name: "ChainvizToken" });
    renderHost(new Map([[target.address, target]]));
    fireEvent.click(screen.getByTestId("trigger-contract-source"));
    expect(screen.getByTestId("contract-source-view")).toBeTruthy();

    fireEvent.click(screen.getByTestId("trigger-eclipse-demo"));
    expect(screen.queryByTestId("contract-source-view")).toBeNull();
    expect(screen.getByTestId("eclipse-demo")).toBeTruthy();
  });

  it("is not affected by the contractSource dangling guard (no target entity of its own)", () => {
    renderHost(new Map());
    fireEvent.click(screen.getByTestId("trigger-eclipse-demo"));
    expect(screen.getByTestId("eclipse-demo")).toBeTruthy();
    expect(screen.getByTestId("side-panel")).toBeTruthy();
  });

  it("starts fresh each time it is reopened (state does not leak across kind switches)", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-eclipse-demo"));
    fireEvent.click(screen.getByTestId("eclipse-demo-add-attacker"));
    expect(screen.getByTestId("eclipse-demo-meter").textContent).toContain("1 / 8");

    // 別 kind へ切り替えてデモをアンマウントし、開き直す。
    fireEvent.click(screen.getByTestId("trigger-glossary"));
    expect(screen.queryByTestId("eclipse-demo")).toBeNull();
    fireEvent.click(screen.getByTestId("trigger-eclipse-demo"));

    // 開き直したら初期状態(0/8)から始まる。
    expect(screen.getByTestId("eclipse-demo-meter").textContent).toContain("0 / 8");
  });
});
