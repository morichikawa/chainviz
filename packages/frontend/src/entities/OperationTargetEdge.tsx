import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
} from "@xyflow/react";
import { OperationTargetEdgePopover } from "./OperationTargetEdgePopover.js";
import type { OperationTargetFlowEdge } from "./operationTargetEdge.js";

/**
 * ワークベンチ → RPC 接続先ノードの常設「操作先」エッジを描くカスタムエッジ
 * （Issue #123 UX設計 §4-4）。揮発性の操作パルス（OperationPulseEdge）と
 * 同系色・低彩度の細い点線にして、「操作すればここへ向かう」関係を常に示す。
 * パルスは走らせない（実際の呼び出しの瞬間は既存の操作パルスが上を走る）。
 *
 * `data.hovered`（Canvas.tsx がホバー中のエッジ id と突き合わせて注入する。
 * `DeployEdge` と同じ仕組み）が true の間は線を太くし、中点付近に
 * `OperationTargetEdgePopover`（「なぜこの1本に固定されているか」の説明）を
 * 出す（Issue #215）。
 */
export function OperationTargetEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps<OperationTargetFlowEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const hovered = data?.hovered ?? false;
  const workbenchContainerName = data?.workbenchContainerName;
  const targetContainerName = data?.targetContainerName;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={hovered ? { ...style, strokeWidth: 2 } : style}
        className={hovered ? "operation-target-edge--hovered" : undefined}
      />
      {hovered && workbenchContainerName && targetContainerName && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
          >
            <OperationTargetEdgePopover
              workbenchContainerName={workbenchContainerName}
              targetContainerName={targetContainerName}
            />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
