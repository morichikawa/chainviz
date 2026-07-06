import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { GhostFlowNode } from "./ghostNode.js";

/**
 * `addNode` / `addWorkbench` コマンド送信直後、実カードが届くまでの間だけ
 * キャンバスに置く半透明の仮カード（Issue #102）。InfraNodeCard と見た目の
 * 骨格（ヘッダ + 名前 + サブタイトル）を揃えつつ、`ghost-card` クラスの
 * 半透明・点線スタイルと「起動中…」表示で「まだ実体ではない」ことを示す。
 * 削除ボタンなどの操作は持たない（コマンド自体を取り消す手段がまだ無いため）。
 */
export function GhostNodeCard({ data }: NodeProps<GhostFlowNode>) {
  const { t } = useLanguage();
  const kindLabel = data.kind === "node" ? t("card.node") : t("card.workbench");

  return (
    <div
      className={`infra-card ghost-card ghost-card--${data.kind}`}
      data-testid={`ghost-card-${data.commandId}`}
    >
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
        <span className="ghost-card__spinner" aria-hidden="true" />
        <span className="infra-card__kind">{kindLabel}</span>
      </div>
      <div className="infra-card__name">{data.label}</div>
      <div className="infra-card__subtitle">{t("ghost.status")}</div>
    </div>
  );
}
