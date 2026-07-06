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
  removable: true,
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
  removable: true,
};

function renderCard(
  entity: InfraEntity,
  actions: Partial<CommandActions> = {},
  extraData: { rpcTargetContainerName?: string; isNew?: boolean } = {},
) {
  const full: CommandActions = {
    addNode: vi.fn(),
    addWorkbench: vi.fn(),
    removeNode: vi.fn(),
    removeWorkbench: vi.fn(),
    ...actions,
  };
  const props = { data: { entity, ...extraData } } as unknown as Parameters<
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

describe("InfraNodeCard remove button visibility (removable)", () => {
  it("does not render a remove button when removable is false (compose起動ノード想定)", () => {
    const unremovable: NodeEntity = { ...node, removable: false };
    renderCard(unremovable);
    expect(screen.queryByTestId("infra-card-remove-reth-follower-1")).toBeNull();
  });

  it("does not render a remove button when removable is undefined (旧スナップショット想定)", () => {
    const withoutRemovable: NodeEntity = { ...node };
    delete withoutRemovable.removable;
    renderCard(withoutRemovable);
    expect(screen.queryByTestId("infra-card-remove-reth-follower-1")).toBeNull();
  });

  it("does not render a remove button for a workbench when removable is false", () => {
    const unremovable: WorkbenchEntity = { ...workbench, removable: false };
    renderCard(unremovable);
    expect(screen.queryByTestId("infra-card-remove-workbench-1")).toBeNull();
  });

  it("does not render a remove button for a workbench when removable is undefined (旧スナップショット想定)", () => {
    // node 側だけでなく workbench 側でも undefined を false 相当に扱うこと。
    const withoutRemovable: WorkbenchEntity = { ...workbench };
    delete withoutRemovable.removable;
    renderCard(withoutRemovable);
    expect(screen.queryByTestId("infra-card-remove-workbench-1")).toBeNull();
  });

  it("renders a remove button when removable is true (addNodeで追加した想定)", () => {
    renderCard({ ...node, removable: true });
    expect(screen.queryByTestId("infra-card-remove-reth-follower-1")).not.toBeNull();
  });

  it("does not render a remove button when removable is a truthy non-boolean via a stale snapshot", () => {
    // === true の厳密比較なので、シリアライズ経由で万一 "true" 文字列などが
    // 紛れ込んでも UI はボタンを出さない（削除不可の安全側）。型を欺いて確認する。
    const corrupted = { ...node, removable: "true" } as unknown as NodeEntity;
    renderCard(corrupted);
    expect(screen.queryByTestId("infra-card-remove-reth-follower-1")).toBeNull();
  });
});

describe("InfraNodeCard bootnode badge (Issue #124 C)", () => {
  it("shows a bootnode badge when p2pRole is bootnode", () => {
    const bootnode: NodeEntity = { ...node, p2pRole: "bootnode" };
    renderCard(bootnode);
    expect(
      screen.getByTestId("infra-card-bootnode-reth-follower-1").textContent,
    ).toBe("ブートノード");
  });

  it("does not show a bootnode badge when p2pRole is peer", () => {
    const peer: NodeEntity = { ...node, p2pRole: "peer" };
    renderCard(peer);
    expect(screen.queryByTestId("infra-card-bootnode-reth-follower-1")).toBeNull();
  });

  it("does not show a bootnode badge when p2pRole is undefined（旧スナップショット想定）", () => {
    const withoutRole: NodeEntity = { ...node };
    delete withoutRole.p2pRole;
    renderCard(withoutRole);
    expect(screen.queryByTestId("infra-card-bootnode-reth-follower-1")).toBeNull();
  });

  it("does not show a bootnode badge for a workbench card", () => {
    renderCard(workbench);
    expect(screen.queryByTestId("infra-card-bootnode-workbench-1")).toBeNull();
  });

  it("shows both the bootnode badge and the remove button (independent of removable)", () => {
    // バッジと削除ボタンは別軸。addNode で追加した(removable) ノードが
    // たまたま bootnode 扱いでも両方独立に出る。
    renderCard({ ...node, p2pRole: "bootnode", removable: true });
    expect(
      screen.queryByTestId("infra-card-bootnode-reth-follower-1"),
    ).not.toBeNull();
    expect(
      screen.queryByTestId("infra-card-remove-reth-follower-1"),
    ).not.toBeNull();
  });

  it("shows the bootnode badge even when the node is not removable (compose起動想定)", () => {
    renderCard({ ...node, p2pRole: "bootnode", removable: false });
    expect(
      screen.queryByTestId("infra-card-bootnode-reth-follower-1"),
    ).not.toBeNull();
    expect(
      screen.queryByTestId("infra-card-remove-reth-follower-1"),
    ).toBeNull();
  });

  it("shows the bootnode badge regardless of sync status (independent fields)", () => {
    renderCard({ ...node, p2pRole: "bootnode", syncStatus: "syncing" });
    expect(
      screen.queryByTestId("infra-card-bootnode-reth-follower-1"),
    ).not.toBeNull();
  });

  it("ignores an unexpected p2pRole value and shows no badge (defensive)", () => {
    // collector は想定外値を peer に正規化するが、旧/壊れたスナップショット
    // 経由で想定外の文字列が届いても、=== "bootnode" の厳密比較で出さない。
    const corrupted = { ...node, p2pRole: "Bootnode" } as unknown as NodeEntity;
    renderCard(corrupted);
    expect(
      screen.queryByTestId("infra-card-bootnode-reth-follower-1"),
    ).toBeNull();
  });
});

describe("InfraNodeCard new-arrival highlight (Issue #123 §4-4)", () => {
  it("does not add the highlight class by default", () => {
    renderCard(node);
    expect(
      screen.getByTestId("infra-card-reth-follower-1").className,
    ).not.toContain("infra-card--new");
  });

  it("adds the highlight class when data.isNew is true", () => {
    renderCard(node, {}, { isNew: true });
    expect(screen.getByTestId("infra-card-reth-follower-1").className).toContain(
      "infra-card--new",
    );
  });

  it("does not add the highlight class when data.isNew is explicitly false", () => {
    renderCard(node, {}, { isNew: false });
    expect(
      screen.getByTestId("infra-card-reth-follower-1").className,
    ).not.toContain("infra-card--new");
  });
});

describe("InfraNodeCard RPC target popover field (Issue #123 §4-4)", () => {
  it("shows the RPC target field on hover when rpcTargetContainerName resolves", () => {
    renderCard(workbench, {}, { rpcTargetContainerName: "chainviz-reth-1" });
    fireEvent.mouseEnter(screen.getByTestId("infra-card-workbench-1"));
    expect(screen.getByText("操作先ノード")).toBeTruthy();
    expect(screen.getByText("chainviz-reth-1")).toBeTruthy();
  });

  it("does not show the RPC target field when it cannot be resolved (Issue #123 §4-5 fallback)", () => {
    renderCard(workbench);
    fireEvent.mouseEnter(screen.getByTestId("infra-card-workbench-1"));
    expect(screen.queryByText("操作先ノード")).toBeNull();
  });

  it("does not show the RPC target field for a node card (workbench-only field)", () => {
    renderCard(node, {}, { rpcTargetContainerName: "chainviz-reth-1" });
    fireEvent.mouseEnter(screen.getByTestId("infra-card-reth-follower-1"));
    expect(screen.queryByText("操作先ノード")).toBeNull();
  });
});
