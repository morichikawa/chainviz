import { Handle, type NodeProps, Position } from "@xyflow/react";
import { useRef, useState } from "react";
import { ActionHint } from "../canvas/ActionHint.js";
import { describeNodeRole, nodeShowsSyncState } from "../chain-profiles/ethereum/nodeRoles.js";
import { useCommandActions } from "../commands/CommandActionsContext.js";
import { resolveWorkbenchOperationsHint } from "../commands/commandMessages.js";
import { pickLocale } from "../i18n/i18n.js";
import { useLanguage } from "../i18n/LanguageProvider.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import { useHoverPopover } from "../interaction/useHoverPopover.js";
import { OperationPanel } from "../operations/OperationPanel.js";
import { InfraNodeCardSyncProgress } from "./InfraNodeCardSyncProgress.js";
import { InfraPopover } from "./InfraPopover.js";
import type { InfraFlowNode } from "./infraNode.js";

/**
 * A層のコンテナを表すキャンバス上のカード（React Flow カスタムノード）。
 * ヘッダにコンテナ名、サブタイトルにクライアント種別/ラベルを出し、
 * ホバーで詳細ポップオーバー（InfraPopover）を表示する。
 *
 * entity が node の場合、`nodeRole` が解釈できればサブタイトルへ
 * 「{役割ラベル} · {clientType}」を出し（Issue #215）、`nodeRole` が
 * `showsSyncState: false`（現状は validator のみ）なら同期状態ドット自体を
 * 描画しない（バリデーターはチェーンを同期する係ではないため）。
 *
 * entity が workbench の場合のみ、カード下部に定型操作パネル（送金/デプロイ/
 * コントラクト呼び出し）を開く全幅ボタンを持つ（ARCHITECTURE.md §6.5。
 * 「操作は必ずワークベンチという実体から発する」ため起点はカード側に置く）。
 *
 * 削除コマンド送信からcommandResultが返るまでの間（`data.removalPending`）は
 * カード全体を半透明化し、削除ボタンをスピナー付きの無効状態にする（Issue
 * #222。追加時の仮カード（`.ghost-card`）と同じ見た目の流儀で「進行中」を
 * 示す）。
 */
export function InfraNodeCard({ data }: NodeProps<InfraFlowNode>) {
  const {
    entity,
    rpcTargetContainerName,
    drivesNodeContainerName,
    drivenByContainerName,
    maxElBlockHeight,
    isNew,
    operationPending,
    removalPending,
  } = data;
  const { t, lang } = useLanguage();
  const actions = useCommandActions();
  // ホバー→ポップオーバーの開閉。カードとポップオーバーの間の隙間を通過する
  // 一瞬だけ mouseleave が発火して消えてしまわないよう、閉じるのは短い遅延
  // ありで行う（Issue #221。詳細は interaction/useHoverPopover.ts 参照）。
  const { isOpen: hovered, onMouseEnter, onMouseLeave } = useHoverPopover();
  const [operationPanelOpen, setOperationPanelOpen] = useState(false);
  // Issue #245: カード本体を InfraPopover の位置合わせの基準（アンカー）にする。
  // React Flow のノードはそれぞれ独立したスタッキングコンテキストを持つため、
  // ポップオーバー自体は body 直下へ portal 描画する（InfraPopover 参照）。
  const cardRef = useRef<HTMLDivElement>(null);

  const kindLabel = entity.kind === "node" ? t("card.node") : t("card.workbench");
  // ノードの役割（execution/consensus/validator）が分かれば
  // 「{役割ラベル} · {clientType}」、分からなければ従来どおり clientType
  // のみを出す（Issue #215。`chain-profiles/ethereum/nodeRoles.ts` が
  // 生の nodeRole の解釈を担い、ここには chainviz-Ethereum 固有のリテラルを
  // 持ち込まない）。
  const nodeRoleDescriptor =
    entity.kind === "node" ? describeNodeRole(entity.nodeRole) : undefined;
  const subtitle =
    entity.kind === "node"
      ? nodeRoleDescriptor
        ? `${pickLocale(nodeRoleDescriptor.label, lang)} · ${entity.clientType}`
        : entity.clientType
      : entity.label;
  const synced = entity.kind === "node" ? entity.syncStatus === "synced" : true;
  // このノードがチェーンのコピーを同期する係か（Issue #215）。validator は
  // ステークで合意に参加する係であり、チェーンを同期する係ではないため、
  // 同期状態ドットを出さない（値ゼロのまま出し続ける旧挙動は「壊れている」
  // 誤解を招く）。workbench は node ではないため常に true 扱い。
  const showsSyncState =
    entity.kind === "node" ? nodeShowsSyncState(entity.nodeRole) : true;
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
    // 削除コマンド送信からcommandResultが返るまでの間だけ付く見た目
    // （半透明化。ゴーストカードと同じ opacity/pointer-events。Issue #222）。
    removalPending ? "infra-card--removing" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={cardRef}
      className={className}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
        {showsSyncState && (
          <span
            className={`infra-card__status ${synced ? "is-synced" : "is-syncing"}`}
            aria-hidden="true"
          />
        )}
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
            aria-label={removalPending ? t("action.remove.pending") : t("action.remove")}
            title={removalPending ? t("action.remove.pending") : t("action.remove")}
            aria-busy={removalPending}
            disabled={removalPending}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onRemove}
            data-testid={`infra-card-remove-${entity.id}`}
          >
            {removalPending ? (
              <span className="infra-card__remove-spinner" aria-hidden="true" />
            ) : (
              "×"
            )}
          </button>
        )}
      </div>
      <div className="infra-card__name">{entity.containerName}</div>
      <div className="infra-card__subtitle">{subtitle}</div>
      {entity.kind === "node" &&
        entity.syncStatus === "syncing" &&
        entity.internals?.syncStages && (
          <InfraNodeCardSyncProgress
            stages={entity.internals.syncStages}
            targetHeight={maxElBlockHeight ?? 0}
          />
        )}
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
          anchorRef={cardRef}
          entity={entity}
          rpcTargetContainerName={rpcTargetContainerName}
          drivesNodeContainerName={drivesNodeContainerName}
          drivenByContainerName={drivenByContainerName}
          maxElBlockHeight={maxElBlockHeight}
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
