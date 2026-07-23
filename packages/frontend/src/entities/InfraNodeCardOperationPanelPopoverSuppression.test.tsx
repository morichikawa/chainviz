import type { WorkbenchEntity } from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandActionsProvider } from "../commands/CommandActionsContext.js";
import type { CommandActions } from "../commands/useCommands.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { OperationDataProvider } from "../operations/OperationDataContext.js";
import { InfraNodeCard } from "./InfraNodeCard.js";

/**
 * Issue #410: ワークベンチの操作パネルが開いている間、そのカードの
 * InfraPopover（ホバー詳細ポップオーバー）と「操作を実行…」ボタンの
 * ActionHint（予告ツールチップ）を表示しないことの確認。
 * InfraNodeCardOperationButton.test.tsx（ボタン・パネルの開閉自体）を
 * 肥大化させないよう別ファイルに分ける。
 */

afterEach(cleanup);

const workbench: WorkbenchEntity = {
  kind: "workbench",
  id: "workbench-1",
  containerName: "chainviz-workbench-1",
  ip: "172.20.0.151",
  ports: [],
  resources: { cpuPercent: 0.2, memMB: 48 },
  process: { name: "foundry" },
  label: "Carol",
  walletIds: [],
  removable: true,
};

function renderCard() {
  const actions: CommandActions = {
    addNode: vi.fn(),
    addWorkbench: vi.fn(),
    removeNode: vi.fn(),
    removeWorkbench: vi.fn(),
    runWorkbenchOperation: vi.fn(),
  };
  render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <CommandActionsProvider actions={actions}>
            <OperationDataProvider
              value={{ walletCandidates: [], deployedContracts: [] }}
            >
              <InfraNodeCard
                {...({ data: { entity: workbench } } as unknown as Parameters<
                  typeof InfraNodeCard
                >[0])}
              />
            </OperationDataProvider>
          </CommandActionsProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
}

const infraPopoverTestId = `infra-popover-${workbench.id}`;
const operateButtonTestId = `infra-card-operate-${workbench.id}`;
const cardTestId = `infra-card-${workbench.id}`;

describe("InfraNodeCard popover suppression while the operation panel is open (Issue #410)", () => {
  it("shows the InfraPopover on hover when the operation panel is closed (baseline)", () => {
    renderCard();
    fireEvent.mouseEnter(screen.getByTestId(cardTestId));
    expect(screen.getByTestId(infraPopoverTestId)).toBeTruthy();
  });

  it("hides the InfraPopover once the operation panel opens, even while still hovered", () => {
    renderCard();
    fireEvent.mouseEnter(screen.getByTestId(cardTestId));
    expect(screen.getByTestId(infraPopoverTestId)).toBeTruthy();

    fireEvent.click(screen.getByTestId(operateButtonTestId));

    // カードの mouseleave は発火していない（操作パネルは .infra-card の
    // DOM子要素として描画されるため）にも関わらず、パネルが開いたことで
    // InfraPopover は消える。
    expect(screen.queryByTestId(infraPopoverTestId)).toBeNull();
  });

  it("restores the normal hover behavior after the panel closes, without needing to re-hover", () => {
    renderCard();
    fireEvent.mouseEnter(screen.getByTestId(cardTestId));
    fireEvent.click(screen.getByTestId(operateButtonTestId));
    expect(screen.queryByTestId(infraPopoverTestId)).toBeNull();

    // ×で閉じる。
    fireEvent.click(screen.getByTestId(operateButtonTestId));
    expect(screen.queryByTestId(`operation-panel-${workbench.id}`)).toBeNull();

    // hovered 自体は一度も変化していなかった(mouseleave が起きていない)ため、
    // 再ホバーしなくても InfraPopover が戻る。
    expect(screen.getByTestId(infraPopoverTestId)).toBeTruthy();
  });

  // ActionHint のポップオーバー自体には data-testid が無いため専用クラスで
  // 特定する（`.infra-popover` も role="tooltip" を持ち、実機と同じく
  // ボタンへ入るまでにカード側の mouseenter も連動して発火するため、
  // getByRole("tooltip") だけでは複数ヒットして曖昧になる）。
  function actionHintPopover(): HTMLElement | null {
    return document.querySelector(".action-hint__popover");
  }

  it("closes the operate button's ActionHint tooltip the moment the panel opens, even though the cursor is still on the button", () => {
    renderCard();
    const operateButton = screen.getByTestId(operateButtonTestId);
    const actionHintWrapper = operateButton.parentElement as HTMLElement;
    fireEvent.mouseEnter(actionHintWrapper);
    expect(actionHintPopover()).toBeTruthy();

    // クリック直後もカーソルはまだボタン上（mouseleave は発火していない）。
    fireEvent.click(operateButton);

    expect(actionHintPopover()).toBeNull();
  });

  it("lets the ActionHint tooltip work normally again after the panel is closed", () => {
    renderCard();
    const operateButton = screen.getByTestId(operateButtonTestId);
    const actionHintWrapper = operateButton.parentElement as HTMLElement;
    fireEvent.mouseEnter(actionHintWrapper);
    fireEvent.click(operateButton); // open
    expect(actionHintPopover()).toBeNull();

    fireEvent.click(operateButton); // close
    expect(screen.queryByTestId(`operation-panel-${workbench.id}`)).toBeNull();

    // suppressed が外れ、既に開いていたホバー状態がそのまま反映されて戻る。
    expect(actionHintPopover()).toBeTruthy();
  });
});
