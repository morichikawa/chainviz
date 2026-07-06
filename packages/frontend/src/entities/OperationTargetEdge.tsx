import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import type { OperationTargetFlowEdge } from "./operationTargetEdge.js";

/**
 * ワークベンチ → RPC 接続先ノードの常設「操作先」エッジを描くカスタムエッジ
 * （Issue #123 UX設計 §4-4）。揮発性の操作パルス（OperationPulseEdge）と
 * 同系色・低彩度の細い点線にして、「操作すればここへ向かう」関係を常に示す。
 * パルスは走らせない（実際の呼び出しの瞬間は既存の操作パルスが上を走る）。
 */
export function OperationTargetEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
}: EdgeProps<OperationTargetFlowEdge>) {
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
