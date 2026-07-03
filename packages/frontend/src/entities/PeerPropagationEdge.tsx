import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import type { PeerFlowEdge } from "./peerEdge.js";

/**
 * B層のピア接続（紐）を描くカスタムエッジ。通常時は `BaseEdge` で紐を1本
 * 引くだけだが、`data.pulses` に伝播パルスが載っている間は、その光の点を
 * SVG の `animateMotion` でエッジ上に走らせる。
 *
 * パルスの進行方向・所要時間は `blockPulse.ts` が実データから算出し、
 * `useBlockPulses` が実時間にスケジュールして `data.pulses` へ流し込む。
 * ここは受け取ったパルスを描くだけで、タイミングの判断は持たない。
 */
export function PeerPropagationEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps<PeerFlowEdge>) {
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const pulses = data?.pulses ?? [];

  return (
    <>
      <BaseEdge id={id} path={edgePath} style={style} />
      {pulses.map((pulse) => (
        <circle key={pulse.key} className="peer-pulse" r={4}>
          <animateMotion
            dur={`${pulse.durationMs}ms`}
            repeatCount="1"
            fill="freeze"
            calcMode="linear"
            keyPoints={pulse.reverse ? "1;0" : "0;1"}
            keyTimes="0;1"
            path={edgePath}
          />
        </circle>
      ))}
    </>
  );
}
