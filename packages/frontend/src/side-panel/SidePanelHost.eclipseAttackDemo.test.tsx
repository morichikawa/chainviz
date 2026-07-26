// SidePanelHost の eclipseAttackDemo kind への振り分け(Issue #416)。
// contractSource kind のダングリングガードは対象外(SidePanelHost.test.tsx
// が担う)。ここでは kind の振り分け・排他制御だけを確認する
// (デモ本体の操作フローは attack-demo/EclipseAttackDemoView.test.tsx が扱う。
// CLAUDE.md のテスト分割方針。SidePanelHost.hashChainDemo.test.tsx と同型)。
import type { ContractEntity } from "@chainviz/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ECLIPSE_DEMO_SLOT_COUNT } from "../attack-demo/eclipseAttackDemo.js";
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

// 以下はテスト強化(Issue #416)で追加した境界ケース。「完全包囲まで進めた
// 状態」を実際のユーザー操作(閉じるボタン・Escape)で閉じてから開き直しても
// 状態が残らないこと(状態の完全な初期化)を固定する。
describe("SidePanelHost: eclipseAttackDemo state does not survive a close/reopen", () => {
  function fillToFullEclipse() {
    for (let i = 0; i < ECLIPSE_DEMO_SLOT_COUNT; i += 1) {
      fireEvent.click(screen.getByTestId("eclipse-demo-add-attacker"));
    }
    expect(screen.getByTestId("eclipse-demo-warning")).toBeTruthy();
  }

  function expectPristineDemo() {
    expect(screen.getByTestId("eclipse-demo-meter").textContent).toContain("0 / 8");
    expect(screen.queryByTestId("eclipse-demo-warning")).toBeNull();
    expect(
      (screen.getByTestId("eclipse-demo-add-attacker") as HTMLButtonElement).disabled,
    ).toBe(false);
  }

  it("starts fresh after a full eclipse is closed with the close button and reopened", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-eclipse-demo"));
    fillToFullEclipse();

    fireEvent.click(screen.getByTestId("side-panel-close"));
    expect(screen.queryByTestId("eclipse-demo")).toBeNull();

    fireEvent.click(screen.getByTestId("trigger-eclipse-demo"));
    expectPristineDemo();
  });

  it("starts fresh after a full eclipse is dismissed with Escape and reopened", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-eclipse-demo"));
    fillToFullEclipse();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("eclipse-demo")).toBeNull();

    fireEvent.click(screen.getByTestId("trigger-eclipse-demo"));
    expectPristineDemo();
  });

  it("keeps the panel open (and the demo state intact) when the same kind is opened again", () => {
    // 同じ kind を再度 open しても再マウントされない = 進捗が消えない。
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-eclipse-demo"));
    fireEvent.click(screen.getByTestId("eclipse-demo-add-attacker"));
    fireEvent.click(screen.getByTestId("eclipse-demo-add-attacker"));
    expect(screen.getByTestId("eclipse-demo-meter").textContent).toContain("2 / 8");

    fireEvent.click(screen.getByTestId("trigger-eclipse-demo"));
    expect(screen.getByTestId("eclipse-demo-meter").textContent).toContain("2 / 8");
  });
});
