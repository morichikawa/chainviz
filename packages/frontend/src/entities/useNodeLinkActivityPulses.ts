import { useEffect, useMemo, useRef, useState } from "react";
import {
  INTERNAL_LINK_PULSE_DURATION_MS,
  type InternalLinkActivitySummary,
  type InternalLinkFlowEdge,
  type InternalLinkPulse,
  type NodeLinkActivitySignal,
  attachInternalLinkActivity,
  internalLinkEdgeId,
} from "./internalLinkEdge.js";

/**
 * 揮発性の `nodeLinkActivity` イベントを監視し、対応する常設の内部リンク
 * エッジへ「1観測 = 1パルス」を走らせつつ、エッジごとの直近観測（ホバー
 * ポップオーバー表示用）を保持するフック（ARCHITECTURE.md §7.6.4）。
 *
 * `useOperationPulses` と同じ「seq 重複排除 + タイマー管理」の構造だが、
 * 操作エッジ（揮発性そのもの）と違い、内部リンクエッジ自体は常設なので
 * ここでは新規にエッジを作らず、渡された `baseEdges`（`drivesNodeId` から
 * 導出済みの常設エッジ）へパルス・直近観測を合成するだけ（`blockPulse.ts` の
 * `attachPulsesToEdges` と同じ役割分担）。
 *
 * 対応する常設エッジが見つからない観測（端点がキャンバス上に無い等）は
 * 無視する（§7.4 ダングリングガード。world-state にも畳み込まない）。
 */
export function useNodeLinkActivityPulses(
  signals: NodeLinkActivitySignal[],
  baseEdges: InternalLinkFlowEdge[],
): InternalLinkFlowEdge[] {
  const [pulsesByEdgeId, setPulsesByEdgeId] = useState<
    Map<string, InternalLinkPulse[]>
  >(new Map());
  const [lastActivityByEdgeId, setLastActivityByEdgeId] = useState<
    Map<string, InternalLinkActivitySummary>
  >(new Map());

  // アニメーション済みイベントの seq。再レンダーで同じイベントを二重に走らせない。
  const seenRef = useRef<Set<number>>(new Set());
  // 実行中のタイマー。アンマウント時にまとめて破棄する。
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());

  // 端点存在判定に使う最新の常設エッジ id 集合。エッジ集合の変化自体では
  // 再スケジュールせず、次のイベント到着時に最新の集合を参照させる
  // （useOperationPulses の presentRef と同じ狙い。deps を signals に絞る）。
  const edgeIdsRef = useRef<Set<string>>(new Set());
  edgeIdsRef.current = new Set(baseEdges.map((edge) => edge.id));

  useEffect(() => {
    const seen = seenRef.current;
    const timers = timersRef.current;

    for (const signal of signals) {
      if (seen.has(signal.seq)) continue;
      seen.add(signal.seq);

      const edgeId = internalLinkEdgeId(
        signal.activity.fromNodeId,
        signal.activity.toNodeId,
      );
      if (!edgeIdsRef.current.has(edgeId)) continue; // ダングリングガード

      setLastActivityByEdgeId((current) => {
        const next = new Map(current);
        next.set(edgeId, {
          calls: signal.activity.calls,
          observedAt: signal.activity.observedAt,
        });
        return next;
      });

      const pulse: InternalLinkPulse = {
        key: `internal-link-pulse-${signal.seq}`,
        durationMs: INTERNAL_LINK_PULSE_DURATION_MS,
      };
      setPulsesByEdgeId((current) => {
        const next = new Map(current);
        const existing = next.get(edgeId) ?? [];
        next.set(edgeId, [...existing, pulse]);
        return next;
      });

      const timer = setTimeout(() => {
        timers.delete(timer);
        setPulsesByEdgeId((current) => {
          const existing = current.get(edgeId);
          if (!existing) return current;
          const remaining = existing.filter((p) => p.key !== pulse.key);
          const next = new Map(current);
          if (remaining.length === 0) next.delete(edgeId);
          else next.set(edgeId, remaining);
          return next;
        });
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

  return useMemo(
    () => attachInternalLinkActivity(baseEdges, pulsesByEdgeId, lastActivityByEdgeId),
    [baseEdges, pulsesByEdgeId, lastActivityByEdgeId],
  );
}
