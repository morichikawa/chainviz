import { BaseEdge, type EdgeProps, getBezierPath } from "@xyflow/react";
import type { ContractCallPulseFlowEdge } from "./contractCallPulseEdge.js";

/**
 * ウォレット → コントラクトへ、tx確定の瞬間だけ一度走る揮発性パルスエッジ
 * （ARCHITECTURE.md §6.6）。CSS の `offset-path`（styles.css の
 * `pulse-travel` キーフレーム。OperationPulseEdge / PeerPropagationEdge と
 * 共通）でエッジ上を走らせる。`useContractSettlementEffects` がパルスの
 * 生成・消滅を管理し、走り終わると消える一時的なエッジ。
 */
export function ContractCallPulseEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  data,
}: EdgeProps<ContractCallPulseFlowEdge>) {
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
        <circle
          key={pulse.key}
          className="contract-call-pulse"
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
