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

type ExtraData = { operationPending?: boolean; rpcTargetContainerName?: string };

function buildProps(entity: InfraEntity, extraData: ExtraData) {
  return { data: { entity, ...extraData } } as unknown as Parameters<
    typeof InfraNodeCard
  >[0];
}

function renderTree(
  props: Parameters<typeof InfraNodeCard>[0],
  actions: CommandActions,
  onAncestorPointerDown?: () => void,
) {
  return (
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
    </ReactFlowProvider>
  );
}

function renderCard(
  entity: InfraEntity,
  extraData: ExtraData = {},
  onAncestorPointerDown?: () => void,
) {
  const actions: CommandActions = {
    addNode: vi.fn(),
    addWorkbench: vi.fn(),
    removeNode: vi.fn(),
    removeWorkbench: vi.fn(),
    runWorkbenchOperation: vi.fn(),
  };
  const { rerender } = render(
    renderTree(buildProps(entity, extraData), actions, onAncestorPointerDown),
  );
  return {
    actions,
    // 上流（App.tsx）が data オブジェクトを差し替えて再レンダーする状況を
    // 再現するための薄いラッパ。extraData だけ差し替えて同じ InfraNodeCard を
    // 更新する（isSameInfraNode の判定でノードオブジェクトが作り直される
    // タイミングの検証に使う）。
    rerenderWith(next: ExtraData) {
      rerender(
        renderTree(buildProps(entity, next), actions, onAncestorPointerDown),
      );
    },
  };
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

  // Issue #237: App.tsx の infraNodesWithHighlight は、対象ワークベンチが
  // 一度も保留(true)を経験していない間、operationPending フィールドを
  // 明示的に merge しないため data.operationPending が undefined のまま
  // 渡ってくることがある（ブロック到達のたびに isSameInfraNode の判定で
  // ノードオブジェクトが差し替わり、一度 true/false を経験していても
  // 再び undefined に戻り得る）。React は aria-* 属性に undefined/null を
  // 渡すと属性自体を DOM から省略するため、`aria-busy={operationPending}`
  // のままだと属性の有無がタイミング依存でフレーキーになる。ここでは
  // その undefined 渡しを直接シミュレートし、DOM 上に常に明示的な
  // aria-busy="false" が出ることを確認する。
  it("always renders an explicit aria-busy attribute even when data.operationPending is undefined (Issue #237)", () => {
    renderCard(workbench, { operationPending: undefined });
    const button = screen.getByTestId(`infra-card-operate-${workbench.id}`);
    expect(button.getAttribute("aria-busy")).toBe("false");
  });

  it("renders aria-busy=true while data.operationPending is true", () => {
    renderCard(workbench, { operationPending: true });
    const button = screen.getByTestId(`infra-card-operate-${workbench.id}`);
    expect(button.getAttribute("aria-busy")).toBe("true");
  });

  // Issue #237 の境界値: undefined / true だけでなく、明示的な false が
  // 渡された場合も aria-busy="false" になる（`?? false` フォールバックが
  // 明示 false を書き換えて消してしまわないこと）を確認する。
  it("renders aria-busy=false when data.operationPending is explicitly false", () => {
    renderCard(workbench, { operationPending: false });
    const button = screen.getByTestId(`infra-card-operate-${workbench.id}`);
    expect(button.getAttribute("aria-busy")).toBe("false");
  });

  // Issue #237 の核心である「タイミング依存の欠落」を、上流の再レンダー列
  // として直接再現する。App.tsx の infraNodesWithHighlight は、対象
  // ワークベンチが保留状態を経験するまでは operationPending を undefined の
  // まま渡し、保留(true)になった後もブロック到達で isSameInfraNode の判定に
  // よりノードオブジェクトが作り直されると再び undefined に戻り得る。
  // その undefined → true → undefined という遷移を通じて、aria-busy 属性が
  // 常に DOM 上に存在し（null にならず）、値だけが正しく切り替わることを
  // 確認する（修正前はこの列の 1 番目と 3 番目で属性自体が欠落した）。
  it("keeps aria-busy present across undefined → true → undefined transitions (Issue #237 object-swap timing)", () => {
    const { rerenderWith } = renderCard(workbench, {
      operationPending: undefined,
    });
    const readAriaBusy = () =>
      screen
        .getByTestId(`infra-card-operate-${workbench.id}`)
        .getAttribute("aria-busy");

    // 一度も保留を経験していない状態（undefined 渡し）。
    expect(readAriaBusy()).toBe("false");

    // 操作を開始して保留（true）になる。
    rerenderWith({ operationPending: true });
    expect(readAriaBusy()).toBe("true");

    // ブロック到達でノードオブジェクトが差し替わり operationPending が
    // undefined に戻る。ここで属性が欠落しない（null にならない）ことが
    // Issue #237 の回帰防止点。
    rerenderWith({ operationPending: undefined });
    expect(readAriaBusy()).toBe("false");
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
