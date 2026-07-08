import {
  BaseEdge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
} from "@xyflow/react";
import {
  INTERNAL_LINK_CORE_OPACITY,
  INTERNAL_LINK_CORE_WIDTH,
  INTERNAL_LINK_CORE_WIDTH_HOVERED,
  INTERNAL_LINK_EDGE_COLOR,
  INTERNAL_LINK_SHEATH_WIDTH_HOVERED,
  type InternalLinkFlowEdge,
} from "./internalLinkEdge.js";
import { InternalLinkEdgePopover } from "./InternalLinkEdgePopover.js";

/**
 * D層: 内部リンクエッジ（beacon(CL) → reth(EL)）を描くカスタムエッジ
 * （ARCHITECTURE.md §7.6.3）。
 *
 * 二重線（配管のメタファー）は、同じベジェパス上に太く低不透明度の「鞘」
 * （`BaseEdge`。`internalLinkEdge.ts` が組み立てた `style` を使う）と、
 * 細く高不透明度の「芯」（追加の `<path>`）を重ねて描くことで表現する
 * （オフセットパスをずらすのではなく、同一パスへの二重描画）。
 *
 * 活動パルス（`data.pulses`）は `PeerPropagationEdge`/`ContractCallPulseEdge`
 * と同じ `offset-path` 走行だが、進行方向は常に source(CL)→target(EL) 固定
 * （ARCHITECTURE.md §7.6.4「進行方向は CL→EL 固定」）なので `reverse` は
 * 扱わない。ホバー中は鞘・芯の両方を太くし、`EdgeLabelRenderer` で
 * `InternalLinkEdgePopover` を表示する（`DeployEdge`/`PeerPropagationEdge` と
 * 同じ流儀）。矢印は付けない（§7.6.3「矢印は付けない」。方向は活動パルスが
 * 伝える）。
 */
export function InternalLinkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps<InternalLinkFlowEdge>) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const hovered = data?.hovered ?? false;
  const pulses = data?.pulses ?? [];
  const drivingContainerName = data?.drivingContainerName ?? "";
  const drivenContainerName = data?.drivenContainerName ?? "";
  const lastActivity = data?.lastActivity;

  const sheathStyle = hovered
    ? { ...style, strokeWidth: INTERNAL_LINK_SHEATH_WIDTH_HOVERED }
    : style;
  const coreWidth = hovered
    ? INTERNAL_LINK_CORE_WIDTH_HOVERED
    : INTERNAL_LINK_CORE_WIDTH;

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={sheathStyle}
        className={hovered ? "internal-link-edge--hovered" : undefined}
      />
      <path
        d={edgePath}
        className="internal-link-edge__core"
        fill="none"
        stroke={INTERNAL_LINK_EDGE_COLOR}
        strokeWidth={coreWidth}
        strokeOpacity={INTERNAL_LINK_CORE_OPACITY}
        pointerEvents="none"
      />
      {pulses.map((pulse) => (
        <circle
          key={pulse.key}
          className="internal-link-pulse"
          r={5}
          style={{
            offsetPath: `path("${edgePath}")`,
            animationDuration: `${pulse.durationMs}ms`,
          }}
        />
      ))}
      {hovered && (
        <EdgeLabelRenderer>
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: "none",
            }}
          >
            <InternalLinkEdgePopover
              drivingContainerName={drivingContainerName}
              drivenContainerName={drivenContainerName}
              lastActivity={lastActivity}
            />
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
