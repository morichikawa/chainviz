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

type ExtraData = {
  rpcTargetContainerName?: string;
  isNew?: boolean;
  removalPending?: boolean;
};

function renderCard(
  entity: InfraEntity,
  actions: Partial<CommandActions> = {},
  extraData: ExtraData = {},
) {
  const full: CommandActions = {
    addNode: vi.fn(),
    addWorkbench: vi.fn(),
    removeNode: vi.fn(),
    removeWorkbench: vi.fn(),
    runWorkbenchOperation: vi.fn(),
    ...actions,
  };
  const buildProps = (data: ExtraData) =>
    ({ data: { entity, ...data } }) as unknown as Parameters<
      typeof InfraNodeCard
    >[0];
  const renderTree = (data: ExtraData) => (
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <CommandActionsProvider actions={full}>
            <InfraNodeCard {...buildProps(data)} />
          </CommandActionsProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>
  );
  const { rerender } = render(renderTree(extraData));
  return {
    ...full,
    // 上流（App.tsx）が data オブジェクトを差し替えて再レンダーする状況を
    // 再現するための薄いラッパ（Issue #263。InfraNodeCardOperationButton.test.tsx
    // の rerenderWith と同型）。既存の戻り値（CommandActions のモック）は
    // スプレッドで維持しているため、`actions.removeNode` 等の既存の呼び出し側
    // には影響しない非破壊な拡張。
    rerenderWith(next: ExtraData) {
      rerender(renderTree(next));
    },
  };
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
                runWorkbenchOperation: vi.fn(),
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

describe("InfraNodeCard node role subtitle (Issue #215)", () => {
  it("shows '{role label} · {clientType}' when nodeRole resolves to a known descriptor", () => {
    renderCard({ ...node, nodeRole: "execution" });
    expect(
      screen.getByTestId("infra-card-reth-follower-1").textContent,
    ).toContain("実行クライアント · reth");
  });

  it("shows the consensus role label for lighthouse when nodeRole is consensus", () => {
    renderCard({ ...node, clientType: "lighthouse", nodeRole: "consensus" });
    expect(
      screen.getByTestId("infra-card-reth-follower-1").textContent,
    ).toContain("コンセンサスクライアント · lighthouse");
  });

  it("shows the validator role label", () => {
    renderCard({ ...node, clientType: "lighthouse", nodeRole: "validator" });
    expect(
      screen.getByTestId("infra-card-reth-follower-1").textContent,
    ).toContain("バリデーター · lighthouse");
  });

  it("falls back to clientType only when nodeRole is undefined (legacy snapshot)", () => {
    renderCard(node);
    const subtitle = screen
      .getByTestId("infra-card-reth-follower-1")
      .querySelector(".infra-card__subtitle");
    expect(subtitle?.textContent).toBe("reth");
  });

  it("falls back to clientType only when nodeRole is an unmapped value", () => {
    renderCard({ ...node, nodeRole: "sequencer" });
    const subtitle = screen
      .getByTestId("infra-card-reth-follower-1")
      .querySelector(".infra-card__subtitle");
    expect(subtitle?.textContent).toBe("reth");
  });

  it("does not affect the workbench subtitle (label, node-only concept)", () => {
    renderCard(workbench);
    const subtitle = screen
      .getByTestId("infra-card-workbench-1")
      .querySelector(".infra-card__subtitle");
    expect(subtitle?.textContent).toBe("Carol");
  });
});

describe("InfraNodeCard sync status dot visibility (Issue #215)", () => {
  it("shows the sync status dot for an execution node", () => {
    renderCard({ ...node, nodeRole: "execution" });
    expect(
      screen
        .getByTestId("infra-card-reth-follower-1")
        .querySelector(".infra-card__status"),
    ).not.toBeNull();
  });

  it("shows the sync status dot when nodeRole is undefined (legacy snapshot fallback)", () => {
    renderCard(node);
    expect(
      screen
        .getByTestId("infra-card-reth-follower-1")
        .querySelector(".infra-card__status"),
    ).not.toBeNull();
  });

  it("hides the sync status dot for a validator node", () => {
    renderCard({ ...node, nodeRole: "validator" });
    expect(
      screen
        .getByTestId("infra-card-reth-follower-1")
        .querySelector(".infra-card__status"),
    ).toBeNull();
  });

  it("still shows the sync status dot for a workbench (kind is never node)", () => {
    renderCard(workbench);
    expect(
      screen
        .getByTestId("infra-card-workbench-1")
        .querySelector(".infra-card__status"),
    ).not.toBeNull();
  });

  it("hides the dot for a validator even when it carries real sync data (display is role-driven, not data-driven)", () => {
    // データと表示ロジックの分離: validator が同期済み・実ブロック高を持って
    // いても、ドット表示は nodeRole だけで決まる（同期データの有無で切り替え
    // ない）。基底 node は synced/blockHeight 10 なので、その状態でも隠れる。
    renderCard({ ...node, nodeRole: "validator", syncStatus: "synced", blockHeight: 999 });
    expect(
      screen
        .getByTestId("infra-card-reth-follower-1")
        .querySelector(".infra-card__status"),
    ).toBeNull();
  });

  it("hides the dot for a syncing validator too (role gating ignores syncStatus)", () => {
    renderCard({ ...node, nodeRole: "validator", syncStatus: "syncing" });
    expect(
      screen
        .getByTestId("infra-card-reth-follower-1")
        .querySelector(".infra-card__status"),
    ).toBeNull();
  });

  it("shows a syncing dot for an execution node with no progress yet (empty data still displayed)", () => {
    // 逆向きの不整合: 役割は execution だが blockHeight 0・syncing という
    // 「データが空」な状態でも、ドットは出す（省略 = 未観測 とは区別し、
    // is-syncing として表示する）。
    renderCard({ ...node, nodeRole: "execution", syncStatus: "syncing", blockHeight: 0 });
    const dot = screen
      .getByTestId("infra-card-reth-follower-1")
      .querySelector(".infra-card__status");
    expect(dot).not.toBeNull();
    expect(dot?.classList.contains("is-syncing")).toBe(true);
  });
});

describe("InfraNodeCard removal-pending feedback (Issue #222)", () => {
  it("does not add the removing class by default", () => {
    renderCard(node);
    expect(
      screen.getByTestId("infra-card-reth-follower-1").className,
    ).not.toContain("infra-card--removing");
  });

  it("adds the removing class and disables the remove button when data.removalPending is true", () => {
    renderCard(node, {}, { removalPending: true });
    expect(
      screen.getByTestId("infra-card-reth-follower-1").className,
    ).toContain("infra-card--removing");
    const button = removeButton("reth-follower-1") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("shows a spinner instead of the × glyph while removalPending", () => {
    renderCard(node, {}, { removalPending: true });
    const button = removeButton("reth-follower-1");
    expect(button.querySelector(".infra-card__remove-spinner")).not.toBeNull();
    expect(button.textContent).not.toContain("×");
  });

  it("shows the × glyph and no spinner by default", () => {
    renderCard(node);
    const button = removeButton("reth-follower-1");
    expect(button.querySelector(".infra-card__remove-spinner")).toBeNull();
    expect(button.textContent).toContain("×");
  });

  it("switches the remove button's label/title to the removing text while pending", () => {
    renderCard(node, {}, { removalPending: true });
    const button = removeButton("reth-follower-1");
    expect(button.getAttribute("aria-label")).toBe("削除中…");
    expect(button.getAttribute("title")).toBe("削除中…");
  });

  it("does not call removeNode when clicking a disabled (removalPending) button", () => {
    const actions = renderCard(node, {}, { removalPending: true });
    fireEvent.click(removeButton("reth-follower-1"));
    expect(actions.removeNode).not.toHaveBeenCalled();
  });

  it("applies the same removing feedback to a workbench card", () => {
    renderCard(workbench, {}, { removalPending: true });
    expect(
      screen.getByTestId("infra-card-workbench-1").className,
    ).toContain("infra-card--removing");
    const button = removeButton("workbench-1") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  // Issue #263: App.tsx の infraNodesWithHighlight は、対象ノード/ワーク
  // ベンチが一度も削除保留(true)を経験していない間、removalPending
  // フィールドを明示的に merge しないため data.removalPending が undefined
  // のまま渡ってくることがある（ブロック到達のたびに isSameInfraNode の
  // 判定でノードオブジェクトが差し替わり、一度 true/false を経験していても
  // 再び undefined に戻り得る）。React は aria-* 属性に undefined/null を
  // 渡すと属性自体を DOM から省略するため、`aria-busy={removalPending}`
  // のままだと属性の有無がタイミング依存でフレーキーになる（Issue #237の
  // operateボタンと全く同じパターン）。ここではその undefined 渡しを直接
  // シミュレートし、DOM 上に常に明示的な aria-busy="false" が出ることを
  // 確認する。
  it("always renders an explicit aria-busy attribute even when data.removalPending is undefined (Issue #263)", () => {
    renderCard(node, {}, { removalPending: undefined });
    const button = removeButton("reth-follower-1");
    expect(button.getAttribute("aria-busy")).toBe("false");
  });

  it("renders aria-busy=true while data.removalPending is true", () => {
    renderCard(node, {}, { removalPending: true });
    const button = removeButton("reth-follower-1");
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  // Issue #263 の境界値: undefined / true だけでなく、明示的な false が
  // 渡された場合も aria-busy="false" になる（`?? false` フォールバックが
  // 明示 false を書き換えて消してしまわないこと）を確認する。
  it("renders aria-busy=false when data.removalPending is explicitly false", () => {
    renderCard(node, {}, { removalPending: false });
    const button = removeButton("reth-follower-1");
    expect(button.getAttribute("aria-busy")).toBe("false");
  });

  // Issue #263 の核心である「タイミング依存の欠落」を、上流の再レンダー列
  // として直接再現する（Issue #237 の operate ボタン向けテストと同型）。
  // undefined → true → undefined という遷移を通じて、aria-busy 属性が常に
  // DOM 上に存在し（null にならず）、値だけが正しく切り替わることを確認
  // する（修正前はこの列の 1 番目と 3 番目で属性自体が欠落した）。
  it("keeps aria-busy present across undefined → true → undefined transitions (Issue #263 object-swap timing)", () => {
    const { rerenderWith } = renderCard(node, {}, { removalPending: undefined });
    const readAriaBusy = () =>
      removeButton("reth-follower-1").getAttribute("aria-busy");

    // 一度も削除保留を経験していない状態（undefined 渡し）。
    expect(readAriaBusy()).toBe("false");

    // 削除コマンドを送信して保留（true）になる。
    rerenderWith({ removalPending: true });
    expect(readAriaBusy()).toBe("true");

    // ブロック到達でノードオブジェクトが差し替わり removalPending が
    // undefined に戻る。ここで属性が欠落しない（null にならない）ことが
    // Issue #263 の回帰防止点。
    rerenderWith({ removalPending: undefined });
    expect(readAriaBusy()).toBe("false");
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
