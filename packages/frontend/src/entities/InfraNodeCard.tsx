import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useState } from "react";
import { ActionHint } from "../canvas/ActionHint.js";
import { useCommandActions } from "../commands/CommandActionsContext.js";
import { resolveWorkbenchOperationsHint } from "../commands/commandMessages.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { OperationPanel } from "../operations/OperationPanel.js";
import { InfraPopover } from "./InfraPopover.js";
import type { InfraFlowNode } from "./infraNode.js";

/**
 * A層のコンテナを表すキャンバス上のカード（React Flow カスタムノード）。
 * ヘッダにコンテナ名、サブタイトルにクライアント種別/ラベルを出し、
 * ホバーで詳細ポップオーバー（InfraPopover）を表示する。
 *
 * entity が workbench の場合のみ、カード下部に定型操作パネル（送金/デプロイ/
 * コントラクト呼び出し）を開く全幅ボタンを持つ（ARCHITECTURE.md §6.5。
 * 「操作は必ずワークベンチという実体から発する」ため起点はカード側に置く）。
 */
export function InfraNodeCard({ data }: NodeProps<InfraFlowNode>) {
  const { entity, rpcTargetContainerName, drivesNodeContainerName, isNew, operationPending } =
    data;
  const { t } = useLanguage();
  const actions = useCommandActions();
  const [hovered, setHovered] = useState(false);
  const [operationPanelOpen, setOperationPanelOpen] = useState(false);

  const kindLabel = entity.kind === "node" ? t("card.node") : t("card.workbench");
  const subtitle =
    entity.kind === "node" ? entity.clientType : entity.label;
  const synced = entity.kind === "node" ? entity.syncStatus === "synced" : true;
  // ブートノードの明示（Issue #124 C）。collector が正規化できなかった
  // 旧スナップショット・別チェーンでは p2pRole が省略されるため、その場合は
  // バッジを出さないフォールバックに倒す（通常ピア前提の表示にしない）。
  const isBootnode = entity.kind === "node" && entity.p2pRole === "bootnode";

  const onRemove = () => {
    if (entity.kind === "node") actions.removeNode(entity.id);
    else actions.removeWorkbench(entity.id);
  };

  // 実カード到着からの一定時間だけ付く新着強調クラス（Issue #123 UX設計
  // §4-4）。isNew の計算・タイマー管理は entities/useNewArrivalHighlight.ts
  // 側の責務で、ここでは受け取ったフラグをクラス名へ反映するだけ。
  const className = [
    "infra-card",
    `infra-card--${entity.kind}`,
    isNew ? "infra-card--new" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid={`infra-card-${entity.id}`}
    >
      {/* B層のピア接続（紐）を留めるためのハンドル。P2P は無向なので
          カードは source / target 両方のハンドルを持つ。見た目は CSS で隠す。 */}
      <Handle
        type="target"
        position={Position.Left}
        className="infra-card__handle"
        isConnectable={false}
      />
      <Handle
        type="source"
        position={Position.Right}
        className="infra-card__handle"
        isConnectable={false}
      />
      <div className="infra-card__header">
        <span
          className={`infra-card__status ${synced ? "is-synced" : "is-syncing"}`}
          aria-hidden="true"
        />
        <span className="infra-card__kind">
          <GlossaryTerm
            termKey={entity.kind === "workbench" ? "workbench" : "container"}
          >
            {kindLabel}
          </GlossaryTerm>
        </span>
        {isBootnode && (
          <span
            className="infra-card__badge--bootnode"
            data-testid={`infra-card-bootnode-${entity.id}`}
          >
            <GlossaryTerm termKey="bootnode">{t("role.bootnode")}</GlossaryTerm>
          </span>
        )}
        {/* React Flow のドラッグ開始を拾わないよう nodrag を付け、ポインタ
            ダウンの伝播も止める。removable が true のときだけ表示し、
            compose起動時など削除できないコンテナには出さない。 */}
        {entity.removable === true && (
          <button
            type="button"
            className="infra-card__remove nodrag"
            aria-label={t("action.remove")}
            title={t("action.remove")}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRemove}
            data-testid={`infra-card-remove-${entity.id}`}
          >
            ×
          </button>
        )}
      </div>
      <div className="infra-card__name">{entity.containerName}</div>
      <div className="infra-card__subtitle">{subtitle}</div>
      {entity.kind === "workbench" && (
        <div className="infra-card__operate-wrapper">
          <ActionHint hint={resolveWorkbenchOperationsHint(rpcTargetContainerName, t)}>
            <button
              type="button"
              className={
                operationPending
                  ? "infra-card__operate nodrag infra-card__operate--pending"
                  : "infra-card__operate nodrag"
              }
              aria-busy={operationPending}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => setOperationPanelOpen((current) => !current)}
              data-testid={`infra-card-operate-${entity.id}`}
            >
              {operationPending && (
                <span className="infra-card__operate-spinner" aria-hidden="true" />
              )}
              {t("action.workbenchOperations")}
              {operationPending ? ` (${t("operation.pending")})` : ""}
            </button>
          </ActionHint>
        </div>
      )}
      {hovered && (
        <InfraPopover
          entity={entity}
          rpcTargetContainerName={rpcTargetContainerName}
          drivesNodeContainerName={drivesNodeContainerName}
        />
      )}
      {entity.kind === "workbench" && operationPanelOpen && (
        <OperationPanel
          workbenchId={entity.id}
          onClose={() => setOperationPanelOpen(false)}
        />
      )}
    </div>
  );
}
