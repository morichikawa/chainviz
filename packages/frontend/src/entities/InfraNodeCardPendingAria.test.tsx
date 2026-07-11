import type { WorkbenchEntity } from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandActionsProvider } from "../commands/CommandActionsContext.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { OperationDataProvider } from "../operations/OperationDataContext.js";
import { InfraNodeCard } from "./InfraNodeCard.js";

/**
 * ワークベンチカードは削除ボタン（Issue #222 / #263）と操作ボタン
 * （ARCHITECTURE.md §6.5 / Issue #237）を同時に持つ唯一のカードで、両方が
 * それぞれ独立した `aria-busy` を出す。個別ボタンの aria-busy 挙動は
 * InfraNodeCard.test.tsx（削除）・InfraNodeCardOperationButton.test.tsx
 * （操作）が既にカバーしているため、このファイルは「同一カード上で 2 つの
 * aria-busy が相互に干渉しないか」という横断的な観点だけに絞る（1 ファイル
 * 1 責務。Issue #263 のテスト強化）。
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

type PendingData = {
  removalPending?: boolean;
  operationPending?: boolean;
};

function buildProps(data: PendingData) {
  return { data: { entity: workbench, ...data } } as unknown as Parameters<
    typeof InfraNodeCard
  >[0];
}

function renderTree(props: Parameters<typeof InfraNodeCard>[0]) {
  return (
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
            <OperationDataProvider
              value={{ walletCandidates: [], deployedContracts: [] }}
            >
              <InfraNodeCard {...props} />
            </OperationDataProvider>
          </CommandActionsProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>
  );
}

function renderCard(data: PendingData = {}) {
  const { rerender } = render(renderTree(buildProps(data)));
  return {
    rerenderWith(next: PendingData) {
      rerender(renderTree(buildProps(next)));
    },
  };
}

const removeAriaBusy = () =>
  screen
    .getByTestId(`infra-card-remove-${workbench.id}`)
    .getAttribute("aria-busy");
const operateAriaBusy = () =>
  screen
    .getByTestId(`infra-card-operate-${workbench.id}`)
    .getAttribute("aria-busy");

describe("InfraNodeCard remove/operate aria-busy independence (Issue #263 / #237)", () => {
  it("renders both a remove button and an operate button on the same workbench card", () => {
    // 前提の確認: この 2 ボタン共存はワークベンチカード固有（node カードは
    // 操作ボタンを持たない）。以降の独立性テストが成り立つ土台。
    renderCard();
    expect(
      screen.queryByTestId(`infra-card-remove-${workbench.id}`),
    ).not.toBeNull();
    expect(
      screen.queryByTestId(`infra-card-operate-${workbench.id}`),
    ).not.toBeNull();
  });

  it("keeps both aria-busy at false when neither field is provided (undefined/undefined)", () => {
    renderCard();
    expect(removeAriaBusy()).toBe("false");
    expect(operateAriaBusy()).toBe("false");
  });

  it("sets only the remove button busy when removalPending is true and operationPending is undefined", () => {
    // 削除保留中でも操作ボタンの aria-busy は false のまま（相互に漏れない）。
    renderCard({ removalPending: true, operationPending: undefined });
    expect(removeAriaBusy()).toBe("true");
    expect(operateAriaBusy()).toBe("false");
  });

  it("sets only the operate button busy when operationPending is true and removalPending is undefined", () => {
    // 操作保留中でも削除ボタンの aria-busy は false のまま。
    renderCard({ removalPending: undefined, operationPending: true });
    expect(removeAriaBusy()).toBe("false");
    expect(operateAriaBusy()).toBe("true");
  });

  it("sets both aria-busy to true when both fields are true (independent, not mutually exclusive)", () => {
    renderCard({ removalPending: true, operationPending: true });
    expect(removeAriaBusy()).toBe("true");
    expect(operateAriaBusy()).toBe("true");
  });

  it("keeps both aria-busy at false when both fields are explicitly false", () => {
    // `?? false` フォールバックが明示 false を書き換えないことを 2 ボタン同時に確認。
    renderCard({ removalPending: false, operationPending: false });
    expect(removeAriaBusy()).toBe("false");
    expect(operateAriaBusy()).toBe("false");
  });

  it("distinguishes mixed explicit false / true across the two buttons", () => {
    renderCard({ removalPending: false, operationPending: true });
    expect(removeAriaBusy()).toBe("false");
    expect(operateAriaBusy()).toBe("true");
  });

  it("toggling one button's pending state across re-renders does not disturb the other's aria-busy", () => {
    // 上流（App.tsx）の再レンダー列で片方だけが undefined ⇄ true と揺れても、
    // もう片方の aria-busy が巻き添えで欠落・変化しないことを確認する。
    const { rerenderWith } = renderCard({
      removalPending: undefined,
      operationPending: true,
    });
    // 起点: 操作は保留中、削除は未経験（undefined→false）。
    expect(removeAriaBusy()).toBe("false");
    expect(operateAriaBusy()).toBe("true");

    // 削除だけが保留に入る。操作側は true のまま影響を受けない。
    rerenderWith({ removalPending: true, operationPending: true });
    expect(removeAriaBusy()).toBe("true");
    expect(operateAriaBusy()).toBe("true");

    // ブロック到達でオブジェクトが差し替わり、削除だけ undefined に戻る。
    // 操作側は true のまま、削除側は属性欠落せず false になる。
    rerenderWith({ removalPending: undefined, operationPending: true });
    expect(removeAriaBusy()).toBe("false");
    expect(operateAriaBusy()).toBe("true");

    // 今度は操作側だけ undefined に戻る。削除側の false は保たれる。
    rerenderWith({ removalPending: undefined, operationPending: undefined });
    expect(removeAriaBusy()).toBe("false");
    expect(operateAriaBusy()).toBe("false");
  });
});
