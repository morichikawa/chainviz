import { useLanguage } from "../i18n/LanguageProvider.js";
import { LayerBadge } from "./LayerBadge.js";

/**
 * 操作先エッジ（ワークベンチ → RPC 接続先ノード）へのホバーで出す
 * ポップオーバーの中身（`PeerEdgePopover`/`DeployEdgePopover` と同型。
 * 位置決めは呼び出し側の `OperationTargetEdge`（`EdgeLabelRenderer`）が
 * 持ち、ここは中身の描画だけに専念する。Issue #215）。
 *
 * `rpc-endpoint` の用語解説アンカーはここには置かない。`EdgeLabelRenderer`
 * のラッパーが `pointerEvents: "none"` のため、この中の要素をホバーしても
 * 用語ポップオーバーは開けない（`docs/worklog/issue-211.md`「14. 設計メモ」
 * の注意点）。アンカーはワークベンチの詳細ポップオーバー（`InfraPopover`
 * の「操作先ノード」欄）側に置いてある。
 */
export function OperationTargetEdgePopover({
  workbenchContainerName,
  targetContainerName,
}: {
  workbenchContainerName: string;
  targetContainerName: string;
}) {
  const { t } = useLanguage();

  return (
    <div className="operation-target-popover nodrag nopan" role="tooltip">
      <div className="operation-target-popover__heading">
        <span>{t("edge.operationTarget")}</span>
        <LayerBadge layer="c" />
      </div>
      <div className="operation-target-popover__endpoints">
        {workbenchContainerName} → {targetContainerName}
      </div>
      <div className="operation-target-popover__hint">
        {t("edge.operationTarget.hint")}
      </div>
    </div>
  );
}
