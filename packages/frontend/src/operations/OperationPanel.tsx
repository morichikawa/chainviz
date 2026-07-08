import { useEffect, useRef, useState } from "react";
import { ETHEREUM_OPERATION_CATALOG } from "../chain-profiles/ethereum/operationCatalog.js";
import { useCommandActions } from "../commands/CommandActionsContext.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { CallForm } from "./CallForm.js";
import { DeployForm } from "./DeployForm.js";
import { useOperationData } from "./OperationDataContext.js";
import { TransferForm } from "./TransferForm.js";

export interface OperationPanelProps {
  workbenchId: string;
  onClose: () => void;
}

type OperationTab = "transfer" | "deploy" | "call";

const TABS: OperationTab[] = ["transfer", "deploy", "call"];

/**
 * ワークベンチカード脇のポップオーバーとして開く、定型操作パネル
 * （ARCHITECTURE.md §6.5「操作パネル」）。送金/デプロイ/コントラクト呼び出し
 * の3タブを持つ。Esc・外側クリック・×で閉じる（nodrag/nowheel/nopan を
 * 付与し、React Flow のドラッグ・ズーム操作と競合しないようにする）。
 *
 * どのタブも、送信すると即座に `runWorkbenchOperation` を発行してパネルを
 * 閉じる（§6.5「パネルを閉じ、ワークベンチカードにスピナー…を出す」。
 * 実行後の進捗はカード側のスピナー・既存の観測機構（操作パルス・確定
 * フラッシュ等）に委ねる）。
 */
export function OperationPanel({ workbenchId, onClose }: OperationPanelProps) {
  const { t } = useLanguage();
  const actions = useCommandActions();
  const { walletCandidates, deployedContracts } = useOperationData();
  const [tab, setTab] = useState<OperationTab>("transfer");
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onCloseRef.current();
    }
    function handlePointerDown(event: PointerEvent) {
      if (
        panelRef.current &&
        event.target instanceof Node &&
        !panelRef.current.contains(event.target)
      ) {
        onCloseRef.current();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", handlePointerDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", handlePointerDown);
    };
  }, []);

  const tabLabelKey: Record<OperationTab, "operation.tab.transfer" | "operation.tab.deploy" | "operation.tab.call"> = {
    transfer: "operation.tab.transfer",
    deploy: "operation.tab.deploy",
    call: "operation.tab.call",
  };

  return (
    <div
      className="operation-panel nodrag nowheel nopan"
      ref={panelRef}
      role="dialog"
      aria-label={t("action.workbenchOperations")}
      data-testid={`operation-panel-${workbenchId}`}
    >
      <div className="operation-panel__header">
        <div className="operation-panel__tabs" role="tablist">
          {TABS.map((candidate) => (
            <button
              key={candidate}
              type="button"
              role="tab"
              aria-selected={tab === candidate}
              className={[
                "operation-panel__tab",
                tab === candidate ? "operation-panel__tab--active" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onClick={() => setTab(candidate)}
              data-testid={`operation-tab-${candidate}`}
            >
              {t(tabLabelKey[candidate])}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="operation-panel__close"
          aria-label={t("operation.close")}
          onClick={onClose}
          data-testid="operation-panel-close"
        >
          ×
        </button>
      </div>
      <div className="operation-panel__body">
        {tab === "transfer" && (
          <TransferForm
            walletCandidates={walletCandidates}
            onSubmit={({ to, amountWei }) => {
              actions.runWorkbenchOperation(workbenchId, {
                type: "transfer",
                to,
                amount: amountWei,
              });
              onClose();
            }}
          />
        )}
        {tab === "deploy" && (
          <DeployForm
            catalog={ETHEREUM_OPERATION_CATALOG}
            onSubmit={({ contractKey, constructorArgs }) => {
              actions.runWorkbenchOperation(workbenchId, {
                type: "deployContract",
                contractKey,
                constructorArgs,
              });
              onClose();
            }}
          />
        )}
        {tab === "call" && (
          <CallForm
            deployedContracts={deployedContracts}
            walletCandidates={walletCandidates}
            onSwitchToDeploy={() => setTab("deploy")}
            onSubmit={({ contractAddress, functionName, args, amountWei }) => {
              actions.runWorkbenchOperation(workbenchId, {
                type: "callContract",
                contractAddress,
                functionName,
                args,
                amount: amountWei,
              });
              onClose();
            }}
          />
        )}
      </div>
    </div>
  );
}
