import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
} from "@xyflow/react";
import { DeployEdgePopover } from "./DeployEdgePopover.js";
import type { DeployFlowEdge } from "./deployEdge.js";

/**
 * ウォレット → コントラクトの「デプロイ」エッジを描くカスタムエッジ
 * （ARCHITECTURE.md §6.3）。B層のピア接続（実線 + パルス）・C層の所有エッジ
 * （琥珀の点線）のどちらとも混同しないよう、コントラクト色の低彩度な細線に
 * する（実際の色は styles.css の `.deploy-edge` が持つ）。パルスは走らせない
 * （静的な所有関係を表す点は所有エッジと同じ）。
 *
 * `data.hovered`（Canvas.tsx がホバー中のエッジ id と突き合わせて注入する。
 * PeerPropagationEdge と同じ仕組み）が true の間は線を太くし、中点付近に
 * 「{address} がデプロイしたコントラクト」のポップオーバーを出す。
 */
export function DeployEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps<DeployFlowEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const hovered = data?.hovered ?? false;
  const deployerAddress = data?.deployerAddress;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={hovered ? { ...style, strokeWidth: 2.6 } : style}
        className={hovered ? "deploy-edge--hovered" : undefined}
      />
      {hovered && deployerAddress && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
          >
            <DeployEdgePopover deployerAddress={deployerAddress} />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
