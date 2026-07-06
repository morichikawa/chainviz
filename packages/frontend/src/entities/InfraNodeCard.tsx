import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useState } from "react";
import { useCommandActions } from "../commands/CommandActionsContext.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { InfraPopover } from "./InfraPopover.js";
import type { InfraFlowNode } from "./infraNode.js";

/**
 * A層のコンテナを表すキャンバス上のカード（React Flow カスタムノード）。
 * ヘッダにコンテナ名、サブタイトルにクライアント種別/ラベルを出し、
 * ホバーで詳細ポップオーバー（InfraPopover）を表示する。
 */
export function InfraNodeCard({ data }: NodeProps<InfraFlowNode>) {
  const { entity } = data;
  const { t } = useLanguage();
  const actions = useCommandActions();
  const [hovered, setHovered] = useState(false);

  const kindLabel = entity.kind === "node" ? t("card.node") : t("card.workbench");
  const subtitle =
    entity.kind === "node" ? entity.clientType : entity.label;
  const synced = entity.kind === "node" ? entity.syncStatus === "synced" : true;

  const onRemove = () => {
    if (entity.kind === "node") actions.removeNode(entity.id);
    else actions.removeWorkbench(entity.id);
  };

  return (
    <div
      className={`infra-card infra-card--${entity.kind}`}
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
      {hovered && <InfraPopover entity={entity} />}
    </div>
  );
}
