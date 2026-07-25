// SidePanelHost の fiftyOnePercentAttackDemo kind への振り分け(Issue #414)。
// contractSource kind のダングリングガードは対象外(SidePanelHost.test.tsx
// が担う)。ここでは kind の振り分け・排他制御だけを確認する(デモ本体の
// 操作フローは attack-demo/FiftyOnePercentAttackDemoView.test.tsx が扱う。
// CLAUDE.md のテスト分割方針)。既存の SidePanelHost.hashChainDemo.test.tsx
// の構成を踏襲する。
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "./SidePanelContext.js";
import { SidePanelHost } from "./SidePanelHost.js";

afterEach(cleanup);

function OpenButtons() {
  const { open } = useSidePanel();
  return (
    <>
      <button
        type="button"
        data-testid="trigger-attack51-demo"
        onClick={() => open({ kind: "fiftyOnePercentAttackDemo" })}
      >
        open fiftyOnePercentAttackDemo
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

function renderHost() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <SidePanelProvider>
          <OpenButtons />
          <SidePanelHost
            contractsByAddress={new Map()}
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

describe("SidePanelHost: fiftyOnePercentAttackDemo kind (Issue #414)", () => {
  it("renders the 51% attack demo panel with a localized title", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-attack51-demo"));
    expect(screen.getByTestId("side-panel")).toBeTruthy();
    expect(screen.getByTestId("attack51-demo")).toBeTruthy();
    expect(screen.getByText("51%攻撃のしくみ")).toBeTruthy();
  });

  it("is not affected by the contractSource dangling guard (no target entity of its own)", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-attack51-demo"));
    expect(screen.getByTestId("attack51-demo")).toBeTruthy();
    expect(screen.getByTestId("side-panel")).toBeTruthy();
  });

  it("is exclusive with the glossary kind (only one panel at a time)", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-glossary"));
    fireEvent.click(screen.getByTestId("trigger-attack51-demo"));
    expect(screen.getByTestId("attack51-demo")).toBeTruthy();

    fireEvent.click(screen.getByTestId("trigger-glossary"));
    expect(screen.queryByTestId("attack51-demo")).toBeNull();

    fireEvent.click(screen.getByTestId("trigger-attack51-demo"));
    expect(screen.getAllByTestId("attack51-demo").length).toBe(1);
  });

  it("starts fresh each time it is reopened (state does not leak across kind switches)", () => {
    renderHost();
    fireEvent.click(screen.getByTestId("trigger-attack51-demo"));
    fireEvent.click(screen.getByTestId("attack51-demo-validator-1"));
    expect(screen.getByTestId("attack51-demo-branch-b-weight").textContent).toBe("1");

    fireEvent.click(screen.getByTestId("trigger-glossary"));
    expect(screen.queryByTestId("attack51-demo")).toBeNull();
    fireEvent.click(screen.getByTestId("trigger-attack51-demo"));

    expect(screen.getByTestId("attack51-demo-branch-b-weight").textContent).toBe("0");
  });
});
