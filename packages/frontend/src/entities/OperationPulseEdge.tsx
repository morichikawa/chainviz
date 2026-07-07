import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import type { OperationFlowEdge } from "./operationEdge.js";

/**
 * ワークベンチ → ノードの RPC 呼び出し（操作）を描くカスタムエッジ。
 * `data.pulses` に乗った光の点を CSS の `offset-path`（styles.css の
 * `pulse-travel` キーフレーム）でエッジ上に走らせる（Issue #125。旧 SVG
 * `animateMotion` から移行。要素の動的挿入時に開始時刻がずれて即終端固定
 * される SMIL のバグを回避するため。PeerPropagationEdge と同じ修正）。
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
        // アニメーションは CSS の offset-path（styles.css の pulse-travel）
        // で行う。SMIL の animateMotion は begin 未指定だと文書タイムライン
        // 0秒起点で解決され、動的挿入時には再生済み扱いとなり fill=freeze
        // で終端に固定されて一度も動かない（Issue #125。PeerPropagationEdge
        // と同じバグ）。source→target固定なので animationDirection は
        // 省略（既定の normal）でよい。
        <circle
          key={pulse.key}
          className="operation-pulse"
          r={5}
          style={{
            offsetPath: `path("${edgePath}")`,
            animationDuration: `${pulse.durationMs}ms`,
          }}
        />
      ))}
    </>
  );
}
