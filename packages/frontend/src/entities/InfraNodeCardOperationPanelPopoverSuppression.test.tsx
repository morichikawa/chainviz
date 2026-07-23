import type { WorkbenchEntity } from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandActionsProvider } from "../commands/CommandActionsContext.js";
import type { CommandActions } from "../commands/useCommands.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { OperationDataProvider } from "../operations/OperationDataContext.js";
import { InfraNodeCard } from "./InfraNodeCard.js";
import type { InfraEntity } from "./infraNode.js";

/**
 * Issue #410: ワークベンチの操作パネルが開いている間、そのカードの
 * InfraPopover（ホバー詳細ポップオーバー）と「操作を実行…」ボタンの
 * ActionHint（予告ツールチップ）を表示しないことの確認。
 * InfraNodeCardOperationButton.test.tsx（ボタン・パネルの開閉自体）を
 * 肥大化させないよう別ファイルに分ける。
 *
 * QA差し戻し（条件4未達）を受けて、カードヘッダーの「ワークベンチ」ラベル
 * （GlossaryTerm）の抑制確認もこのファイルに追加する。操作パネルの開閉
 * (`operationPanelOpen`) に連動する表示抑制という同じ関心事のため。
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

// スコープ確認用の通常ノードカード（entity.kind === "node"）。ワークベンチと
// 違い操作パネル・ActionHint を持たないため、抑制ロジックが誤って影響しては
// ならない対象。
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

function renderCard(entity: InfraEntity = workbench, glossary: Glossary = {}) {
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
        <GlossaryProvider glossary={glossary}>
          <CommandActionsProvider actions={actions}>
            <OperationDataProvider
              value={{ walletCandidates: [], deployedContracts: [] }}
            >
              <InfraNodeCard
                {...({ data: { entity } } as unknown as Parameters<
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

  // 操作パネルを開いた直後にパネル内の入力欄などへフォーカスが移ると、操作
  // ボタンは blur し ActionHint の内部ホバー/フォーカス状態は閉じる。この
  // 場合、パネルを閉じても（＝suppressed が外れても）予告ツールチップは
  // 復活してはいけない（表示と内部状態が食い違わないことの確認）。前の
  // テストは「カーソルがボタン上に残ったまま＝内部状態が開いたまま」戻る
  // ケースで、こちらはその対になる境界。
  it("does not resurrect the ActionHint tooltip after closing the panel if the button lost focus while the panel was open", () => {
    renderCard();
    const operateButton = screen.getByTestId(operateButtonTestId);
    const actionHintWrapper = operateButton.parentElement as HTMLElement;
    fireEvent.mouseEnter(actionHintWrapper);
    fireEvent.click(operateButton); // open panel (suppressed=true)
    expect(actionHintPopover()).toBeNull();

    // フォーカスがパネル内へ移り、操作ボタンから離れる。カーソルもボタンから
    // 外れたとみなす（内部のホバー/フォーカス状態を閉じる）。
    fireEvent.mouseLeave(actionHintWrapper);
    fireEvent.blur(operateButton);

    fireEvent.click(operateButton); // close panel (suppressed=false)
    expect(screen.queryByTestId(`operation-panel-${workbench.id}`)).toBeNull();
    expect(actionHintPopover()).toBeNull();
  });

  // 操作パネルを素早く開閉し続けても、InfraPopover の表示が open/close に
  // 同期し続けることの確認（トグル state と表示条件が食い違って「開いたまま
  // 固まる」等にならないこと）。カードは一度ホバーしたきり mouseleave して
  // いない（hovered は true のまま）ので、パネルが閉じている間は毎回
  // InfraPopover が出て、開いている間は毎回消える。
  it("keeps the InfraPopover in sync while the panel is rapidly toggled open/closed", () => {
    renderCard();
    const card = screen.getByTestId(cardTestId);
    const operateButton = screen.getByTestId(operateButtonTestId);
    fireEvent.mouseEnter(card);
    expect(screen.getByTestId(infraPopoverTestId)).toBeTruthy();

    for (let i = 0; i < 3; i++) {
      fireEvent.click(operateButton); // open
      expect(screen.queryByTestId(infraPopoverTestId)).toBeNull();
      expect(screen.getByTestId(`operation-panel-${workbench.id}`)).toBeTruthy();

      fireEvent.click(operateButton); // close
      expect(screen.getByTestId(infraPopoverTestId)).toBeTruthy();
      expect(
        screen.queryByTestId(`operation-panel-${workbench.id}`),
      ).toBeNull();
    }
  });

  // スコープ確認: 通常ノードカード（entity.kind === "node"）には操作パネル・
  // ActionHint が無く、`operationPanelOpen` は常に false のまま。抑制条件
  // （`!operationPanelOpen`）が誤ってノードカードの InfraPopover を隠したり
  // しないこと（本Issueの修正がワークベンチカードに閉じていることの確認）。
  it("does not affect a plain node card: its InfraPopover shows on hover and it has no operate button", () => {
    renderCard(node);
    expect(screen.queryByTestId(`infra-card-operate-${node.id}`)).toBeNull();
    fireEvent.mouseEnter(screen.getByTestId(`infra-card-${node.id}`));
    expect(screen.getByTestId(`infra-popover-${node.id}`)).toBeTruthy();
  });
});

// QA差し戻し（Issue #410 条件4未達）: カードヘッダーの「ワークベンチ」ラベル
// （GlossaryTerm）の用語解説ポップオーバーが、操作パネルより前面に出て
// パネル本体を覆っていた問題への対応確認。glossary に "workbench" を実際に
// 登録した状態でないと GlossaryTerm は unknown 扱い（ポップオーバー自体を
// 持たない）になるため、この描画確認だけ専用の glossary を使う。
describe("InfraNodeCard header label (GlossaryTerm) suppression while the operation panel is open (Issue #410 follow-up)", () => {
  const glossaryWithWorkbenchTerm: Glossary = {
    workbench: {
      key: "workbench",
      name: { ja: "ワークベンチ", en: "Workbench" },
      definition: { ja: "操作を実行できる作業台", en: "A workbench for running operations" },
      layer: "a-infra",
      relatedTerms: [],
    },
  };

  function headerLabel(): HTMLElement {
    return screen.getByTestId(`infra-card-${workbench.id}`).querySelector(
      ".infra-card__kind [role='button']",
    ) as HTMLElement;
  }

  it("shows the header label's popover on hover when the operation panel is closed (baseline)", () => {
    renderCard(workbench, glossaryWithWorkbenchTerm);
    fireEvent.mouseEnter(headerLabel());
    expect(document.querySelector(`[data-testid="glossary-popover-workbench"]`)).toBeTruthy();
  });

  it("hides the header label's popover once the operation panel opens, even while still hovered", () => {
    renderCard(workbench, glossaryWithWorkbenchTerm);
    const label = headerLabel();
    fireEvent.mouseEnter(label);
    expect(document.querySelector(`[data-testid="glossary-popover-workbench"]`)).toBeTruthy();

    fireEvent.click(screen.getByTestId(operateButtonTestId));

    expect(document.querySelector(`[data-testid="glossary-popover-workbench"]`)).toBeNull();
  });

  it("restores the header label's popover after the panel closes, without needing to re-hover", () => {
    renderCard(workbench, glossaryWithWorkbenchTerm);
    const label = headerLabel();
    fireEvent.mouseEnter(label);
    fireEvent.click(screen.getByTestId(operateButtonTestId)); // open panel
    expect(document.querySelector(`[data-testid="glossary-popover-workbench"]`)).toBeNull();

    fireEvent.click(screen.getByTestId(operateButtonTestId)); // close panel
    expect(document.querySelector(`[data-testid="glossary-popover-workbench"]`)).toBeTruthy();
  });

  // スコープ確認: 通常ノードカードには操作パネルが無く operationPanelOpen は
  // 常に false のため、ヘッダーラベル（termKey="container"）のポップオーバー
  // は通常どおりホバーで表示される。
  it("does not affect a plain node card's header label popover", () => {
    renderCard(node, { ...glossaryWithWorkbenchTerm, container: {
      key: "container",
      name: { ja: "コンテナ", en: "Container" },
      definition: { ja: "隔離された実行単位", en: "An isolated runtime unit" },
      layer: "a-infra",
      relatedTerms: [],
    } });
    const label = screen.getByTestId(`infra-card-${node.id}`).querySelector(
      ".infra-card__kind [role='button']",
    ) as HTMLElement;
    fireEvent.mouseEnter(label);
    expect(document.querySelector(`[data-testid="glossary-popover-container"]`)).toBeTruthy();
  });
});
