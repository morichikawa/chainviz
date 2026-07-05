import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import type { OwnershipFlowEdge } from "./ownershipEdge.js";

/**
 * ワークベンチ → ウォレットの「所有」エッジを描くカスタムエッジ。
 * B層の P2P ピア接続（PeerPropagationEdge）と意味的に別物なので、点線・別色
 * （--own-edge）で視覚的に区別する。パルスは走らせない（伝播ではなく静的な
 * 所有関係を表すため）。
 */
export function OwnershipEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
}: EdgeProps<OwnershipFlowEdge>) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  return (
    <BaseEdge
      id={id}
      path={edgePath}
      markerEnd={markerEnd}
      style={{
        stroke: "var(--own-edge)",
        strokeWidth: 1.8,
        strokeDasharray: "6 4",
      }}
    />
  );
}
