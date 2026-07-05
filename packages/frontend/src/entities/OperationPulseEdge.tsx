import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import type { OperationFlowEdge } from "./operationEdge.js";

/**
 * ワークベンチ → ノードの RPC 呼び出し（操作）を描くカスタムエッジ。
 * `data.pulses` に乗った光の点を SVG の `animateMotion` でエッジ上に走らせる。
 *
 * このエッジは操作が観測された瞬間だけ一時的に存在し（`useOperationPulses` が
 * パルスの生成・消滅を管理する）、パルスが走り終わると消える。B層のブロック伝播
 * パルス（PeerPropagationEdge）と意味・見た目が別物なので、線・パルスとも別色
 * （--op-edge / .operation-pulse）で区別する。進行方向は常に source（ワークベンチ）
 * → target（ノード）なので、peer のような reverse は扱わない。
 */
export function OperationPulseEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps<OperationFlowEdge>) {
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
        <circle key={pulse.key} className="operation-pulse" r={5}>
          <animateMotion
            dur={`${pulse.durationMs}ms`}
            repeatCount="1"
            fill="freeze"
            calcMode="linear"
            keyPoints="0;1"
            keyTimes="0;1"
            path={edgePath}
          />
        </circle>
      ))}
    </>
  );
}
