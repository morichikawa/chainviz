import { Handle, type NodeProps, Position } from "@xyflow/react";
import { format } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import type { GhostFlowNode } from "./ghostNode.js";

/**
 * `addNode` / `addWorkbench` コマンド送信直後、実カードが届くまでの間だけ
 * キャンバスに置く半透明の仮カード（Issue #102）。InfraNodeCard と見た目の
 * 骨格（ヘッダ + 名前 + サブタイトル）を揃えつつ、`ghost-card` クラスの
 * 半透明・点線スタイルと「起動中…」表示で「まだ実体ではない」ことを示す。
 * 削除ボタンなどの操作は持たない（コマンド自体を取り消す手段がまだ無いため）。
 *
 * Issue #123 UX設計 §4-2: addNode は reth/beacon の2枚のゴーストになるため、
 * kind === "node" のカード名は確定前提の chainProfile 文字列ではなく
 * 「新しいノード (reth)」「新しいノード (beacon)」（`data.layer` から解決）に
 * する。接続予定先（`data.targetContainerName`）を解決できた場合はサブタイトル
 * に「起動中… {target} と接続予定」を出し、できなければ従来どおり
 * 「起動中…」のみにフォールバックする（§4-5）。
 */
export function GhostNodeCard({ data }: NodeProps<GhostFlowNode>) {
  const { t } = useLanguage();
  const kindLabel = data.kind === "node" ? t("card.node") : t("card.workbench");

  const nodeLayerNameKey =
    data.layer === "execution"
      ? "ghost.node.execution"
      : data.layer === "consensus"
        ? "ghost.node.consensus"
        : undefined;
  // layer が無い（旧呼び出し・想定外の生成物）場合は data.label へフォールバック
  // する。workbench は元々 data.label（入力されたワークベンチ名）を名前にする。
  const name = nodeLayerNameKey ? t(nodeLayerNameKey) : data.label;

  const subtitle = data.targetContainerName
    ? `${t("ghost.status")} ${format(
        t(data.kind === "workbench" ? "ghost.rpcTarget" : "ghost.willConnect"),
        { target: data.targetContainerName },
      )}`
    : t("ghost.status");

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
      <div className="infra-card__name">{name}</div>
      <div className="infra-card__subtitle">{subtitle}</div>
    </div>
  );
}
