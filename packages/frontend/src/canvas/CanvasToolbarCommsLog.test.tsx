// CanvasToolbar の通信ログトグルボタン（Issue #317）専用のテスト。
// 既存の CanvasToolbar.test.tsx / CanvasToolbarPairHint.test.tsx とは
// 関心事が異なるため分ける（CLAUDE.md のテスト分割方針）。
// 開閉状態（SidePanelContext）を検証する必要があるため、
// `canvasToolbarHarness.tsx` は使わず ContractCard.test.tsx と同じ
// プローブ方式で自前レンダーする。

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandActionsProvider } from "../commands/CommandActionsContext.js";
import type { CommandActions } from "../commands/useCommands.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "../side-panel/SidePanelContext.js";
import { testGlossary } from "./canvasToolbarHarness.js";
import { CanvasToolbar } from "./CanvasToolbar.js";

afterEach(cleanup);

function noopActions(): CommandActions {
  return {
    addNode: vi.fn(),
    addWorkbench: vi.fn(),
    removeNode: vi.fn(),
    removeWorkbench: vi.fn(),
    runWorkbenchOperation: vi.fn(),
  };
}

/** テスト内で現在の SidePanelView.kind を可視化するプローブ。 */
function OpenedKindProbe() {
  const { view } = useSidePanel();
  return <span data-testid="opened-kind">{view?.kind ?? ""}</span>;
}

function renderWithSidePanel() {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={testGlossary}>
        <CommandActionsProvider actions={noopActions()}>
          <SidePanelProvider>
            <OpenedKindProbe />
            <CanvasToolbar />
          </SidePanelProvider>
        </CommandActionsProvider>
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("CanvasToolbar: comms log toggle (Issue #317)", () => {
  it("is not pressed and no panel is open initially", () => {
    renderWithSidePanel();
    const button = screen.getByTestId("canvas-toolbar-comms-log");
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("opened-kind").textContent).toBe("");
  });

  it("opens the commsLog panel on click", () => {
    renderWithSidePanel();
    fireEvent.click(screen.getByTestId("canvas-toolbar-comms-log"));
    expect(screen.getByTestId("opened-kind").textContent).toBe("commsLog");
    expect(screen.getByTestId("canvas-toolbar-comms-log").getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("closes the panel when clicked again while open", () => {
    renderWithSidePanel();
    const button = screen.getByTestId("canvas-toolbar-comms-log");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(screen.getByTestId("opened-kind").textContent).toBe("");
    expect(button.getAttribute("aria-pressed")).toBe("false");
  });
});
