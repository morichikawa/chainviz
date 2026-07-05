import { useEffect, useRef, useState } from "react";
import {
  type OperationFlowEdge,
  type OperationPulse,
  type OperationSignal,
  OPERATION_PULSE_DURATION_MS,
  addOperationPulse,
  buildOperationFlowEdge,
  removeOperationPulse,
} from "./operationEdge.js";

/**
 * 揮発性の操作観測イベント（ワークベンチ → ノードの RPC 呼び出し）を監視し、
 * 対応する一時的なエッジ上へパルスを 1 回走らせるためのフック。
 *
 * ブロック伝播パルス（`useBlockPulses`）と同じ構造を踏襲するが、操作エッジは
 * ワールドステートに保存されないため、パルスが流れている間だけ一時的にエッジを
 * 生成し、走り終わったらエッジごと消す点が異なる（peer はエッジが永続し、その上に
 * パルスが乗る）。純粋なデータ変換は `operationEdge.ts` に置き、ここは
 * 「新しいイベントの検知・実時間へのスケジューリング・後片付け」という
 * React / タイマー側の責務だけを持つ。
 *
 * 端点（ワークベンチ・ノード）のどちらかがキャンバス上に存在しない場合は、
 * そのイベントを無視する（宙ぶらりんのエッジを描かない）。
 */
export function useOperationPulses(
  signals: OperationSignal[],
  presentInfraIds: Iterable<string>,
): OperationFlowEdge[] {
  const [edges, setEdges] = useState<OperationFlowEdge[]>([]);

  // アニメーション済みイベントの seq。再レンダーで同じイベントを二重に走らせない。
  const seenRef = useRef<Set<number>>(new Set());
  // 実行中のタイマー。アンマウント時にまとめて破棄する。
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // 端点存在判定に使う最新の infra ID 集合。エッジ集合の変化では再スケジュール
  // せず、次のイベント到着時に最新の集合を参照させる（deps を signals に絞る）。
  const presentRef = useRef<Set<string>>(new Set());
  presentRef.current =
    presentInfraIds instanceof Set
      ? presentInfraIds
      : new Set<string>(presentInfraIds);

  useEffect(() => {
    const seen = seenRef.current;
    const timers = timersRef.current;

    for (const signal of signals) {
      if (seen.has(signal.seq)) continue;
      seen.add(signal.seq);

      const base = buildOperationFlowEdge(signal.edge, presentRef.current);
      if (!base) continue; // ワークベンチ / ノードが不在 → アニメーションしない

      const pulse: OperationPulse = {
        key: `op-pulse-${signal.seq}`,
        durationMs: OPERATION_PULSE_DURATION_MS,
      };
      setEdges((cur) => addOperationPulse(cur, base, pulse));

      const timer = setTimeout(() => {
        timers.delete(timer);
        setEdges((cur) => removeOperationPulse(cur, base.id, pulse.key));
      }, pulse.durationMs);
      timers.add(timer);
    }
  }, [signals]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return edges;
}
