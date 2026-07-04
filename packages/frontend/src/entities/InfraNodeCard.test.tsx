import type { NodeEntity, WorkbenchEntity } from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandActionsProvider } from "../commands/CommandActionsContext.js";
import type { CommandActions } from "../commands/useCommands.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { InfraNodeCard } from "./InfraNodeCard.js";
import type { InfraEntity } from "./infraNode.js";

afterEach(cleanup);

const node: NodeEntity = {
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
};

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
};

function renderCard(entity: InfraEntity, actions: Partial<CommandActions> = {}) {
  const full: CommandActions = {
    addNode: vi.fn(),
    addWorkbench: vi.fn(),
    removeNode: vi.fn(),
    removeWorkbench: vi.fn(),
    ...actions,
  };
  const props = { data: { entity } } as unknown as Parameters<
    typeof InfraNodeCard
  >[0];
  render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <CommandActionsProvider actions={full}>
            <InfraNodeCard {...props} />
          </CommandActionsProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
  return full;
}

const removeButton = (id: string) => screen.getByTestId(`infra-card-remove-${id}`);

describe("InfraNodeCard remove button", () => {
  it("calls removeNode with the node id for a node card", () => {
    const actions = renderCard(node);
    fireEvent.click(removeButton("reth-follower-1"));
    expect(actions.removeNode).toHaveBeenCalledWith("reth-follower-1");
    expect(actions.removeWorkbench).not.toHaveBeenCalled();
  });

  it("calls removeWorkbench with the workbench id for a workbench card", () => {
    const actions = renderCard(workbench);
    fireEvent.click(removeButton("workbench-1"));
    expect(actions.removeWorkbench).toHaveBeenCalledWith("workbench-1");
    expect(actions.removeNode).not.toHaveBeenCalled();
  });

  it("marks the remove button with nodrag so React Flow ignores it for dragging", () => {
    renderCard(node);
    expect(removeButton("reth-follower-1").classList.contains("nodrag")).toBe(true);
  });

  it("stops pointerdown from bubbling to the card (avoids drag-vs-click conflict)", () => {
    const ancestorPointerDown = vi.fn();
    render(
      <ReactFlowProvider>
        <LanguageProvider initialLanguage="ja">
          <GlossaryProvider glossary={{}}>
            <CommandActionsProvider
              actions={{
                addNode: vi.fn(),
                addWorkbench: vi.fn(),
                removeNode: vi.fn(),
                removeWorkbench: vi.fn(),
              }}
            >
              {/* React Flow のノードラッパ相当。ここへ pointerdown が伝播すると
                  ドラッグが始まってしまうため、削除ボタンで止まることを検証する。 */}
              <div onPointerDown={ancestorPointerDown}>
                <InfraNodeCard
                  {...({ data: { entity: node } } as unknown as Parameters<
                    typeof InfraNodeCard
                  >[0])}
                />
              </div>
            </CommandActionsProvider>
          </GlossaryProvider>
        </LanguageProvider>
      </ReactFlowProvider>,
    );

    fireEvent.pointerDown(removeButton("reth-follower-1"));
    expect(ancestorPointerDown).not.toHaveBeenCalled();
  });

  it("still renders a remove button for a syncing node", () => {
    const syncing: NodeEntity = { ...node, syncStatus: "syncing" };
    const actions = renderCard(syncing);
    fireEvent.click(removeButton("reth-follower-1"));
    expect(actions.removeNode).toHaveBeenCalledWith("reth-follower-1");
  });

  it("dispatches once per click with no built-in double-submit guard", () => {
    // 削除ボタン連打の二重送信防止は UI 側では行わない（各クリックが1発行）。
    const actions = renderCard(node);
    const button = removeButton("reth-follower-1");
    fireEvent.click(button);
    fireEvent.click(button);
    expect(actions.removeNode).toHaveBeenCalledTimes(2);
  });
});
