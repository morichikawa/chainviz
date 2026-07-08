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
import type { InfraEntity } from "./infraNode.js";

/**
 * InfraNodeCard の「操作を実行…」ボタン・操作パネルの開閉・保留スピナー
 * （ARCHITECTURE.md §6.5）に絞ったテスト。既存の InfraNodeCard.test.tsx
 * （削除ボタン・バッジ等）を肥大化させないよう別ファイルに分ける（Issue #167）。
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

const node: InfraEntity = {
  kind: "node",
  id: "reth-follower-1",
  containerName: "chainviz-reth-follower-1",
  ip: "172.20.0.101",
  ports: [8545],
  resources: { cpuPercent: 1, memMB: 100 },
  process: { name: "reth node" },
  chainType: "ethereum",
  clientType: "reth",
  syncStatus: "synced",
  blockHeight: 10,
  headBlockHash: "0xabc",
  removable: true,
};

function renderCard(
  entity: InfraEntity,
  extraData: { operationPending?: boolean; rpcTargetContainerName?: string } = {},
  onAncestorPointerDown?: () => void,
) {
  const actions: CommandActions = {
    addNode: vi.fn(),
    addWorkbench: vi.fn(),
    removeNode: vi.fn(),
    removeWorkbench: vi.fn(),
    runWorkbenchOperation: vi.fn(),
  };
  const props = { data: { entity, ...extraData } } as unknown as Parameters<
    typeof InfraNodeCard
  >[0];
  render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <CommandActionsProvider actions={actions}>
            <OperationDataProvider
              value={{ walletCandidates: [], deployedContracts: [] }}
            >
              {/* React Flow のノードラッパ相当。pointerdown 伝播の確認用
                  （InfraNodeCard.test.tsx の削除ボタン検証と同じパターン）。 */}
              <div onPointerDown={onAncestorPointerDown}>
                <InfraNodeCard {...props} />
              </div>
            </OperationDataProvider>
          </CommandActionsProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
  return { actions };
}

describe("InfraNodeCard operate button (ARCHITECTURE.md §6.5)", () => {
  it("shows the 'run operation…' button for a workbench card", () => {
    renderCard(workbench);
    expect(
      screen.getByTestId(`infra-card-operate-${workbench.id}`),
    ).toBeTruthy();
  });

  it("does not show the operate button for a node card (operations only originate from a workbench)", () => {
    renderCard(node);
    expect(screen.queryByTestId(`infra-card-operate-${node.id}`)).toBeNull();
  });

  it("opens the operation panel on click", () => {
    renderCard(workbench);
    fireEvent.click(screen.getByTestId(`infra-card-operate-${workbench.id}`));
    expect(
      screen.getByTestId(`operation-panel-${workbench.id}`),
    ).toBeTruthy();
  });

  it("toggles the panel closed on a second click", () => {
    renderCard(workbench);
    const button = screen.getByTestId(`infra-card-operate-${workbench.id}`);
    fireEvent.click(button);
    fireEvent.click(button);
    expect(
      screen.queryByTestId(`operation-panel-${workbench.id}`),
    ).toBeNull();
  });

  it("closes the panel when the panel's own onClose fires (e.g. Escape)", () => {
    renderCard(workbench);
    fireEvent.click(screen.getByTestId(`infra-card-operate-${workbench.id}`));
    expect(screen.getByTestId(`operation-panel-${workbench.id}`)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(
      screen.queryByTestId(`operation-panel-${workbench.id}`),
    ).toBeNull();
  });

  it("shows a pending spinner and running-label when data.operationPending is true", () => {
    renderCard(workbench, { operationPending: true });
    const button = screen.getByTestId(`infra-card-operate-${workbench.id}`);
    expect(button.className).toContain("infra-card__operate--pending");
    expect(button.querySelector(".infra-card__operate-spinner")).not.toBeNull();
    expect(button.textContent).toContain("実行中…");
  });

  it("does not show the pending spinner by default", () => {
    renderCard(workbench);
    const button = screen.getByTestId(`infra-card-operate-${workbench.id}`);
    expect(button.className).not.toContain("infra-card__operate--pending");
  });

  it("still allows opening the panel while pending (no double-submit guard, ARCHITECTURE.md §6.5)", () => {
    renderCard(workbench, { operationPending: true });
    fireEvent.click(screen.getByTestId(`infra-card-operate-${workbench.id}`));
    expect(screen.getByTestId(`operation-panel-${workbench.id}`)).toBeTruthy();
  });

  it("stops pointerdown from bubbling to the card (avoids drag-vs-click conflict)", () => {
    const ancestorPointerDown = vi.fn();
    renderCard(workbench, {}, ancestorPointerDown);
    fireEvent.pointerDown(
      screen.getByTestId(`infra-card-operate-${workbench.id}`),
    );
    expect(ancestorPointerDown).not.toHaveBeenCalled();
  });
});
