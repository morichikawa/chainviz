import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import type { PendingConnectionFlowEdge } from "./pendingConnectionEdge.js";

/**
 * ゴースト（仮カード）から接続予定先ノードへの「接続予定エッジ」を描く
 * カスタムエッジ（Issue #123 UX設計 §4-2）。まだ実接続ではないことを示すため、
 * 実エッジより低彩度の点線にする。node ゴースト由来（ピア接続系の色）と
 * workbench ゴースト由来（操作エッジ系の色）を `className`
 * （pendingConnectionEdge.ts が付与）で塗り分ける（実際の色は styles.css）。
 */
export function PendingConnectionEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps<PendingConnectionFlowEdge>) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return <BaseEdge id={id} path={edgePath} />;
}
