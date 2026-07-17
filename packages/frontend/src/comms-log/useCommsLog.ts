import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConnectionStatus } from "../websocket/client.js";
import type { DiffObserver } from "../world-state/useWorldState.js";
import type { CommsLogCategory, CommsLogEntry } from "./commsLogEntry.js";
import {
  applyCommsLogFilter,
  type CommsLogFilterState,
  defaultCommsLogFilterState,
  toggleCommsLogCategory,
} from "./commsLogFilter.js";
import { deriveCommsLogEntries } from "./deriveCommsLogEntries.js";

/**
 * 通信ログのリングバッファ上限（Issue #317設計メモ §6）。
 *
 * この固定値 500 が成立する前提条件（CLAUDE.md「今この瞬間に観測できる
 * 状態に依存した固定値をロジックに埋め込まない」対応）: 実環境（slot 12秒・
 * ノード5枚前後）でおよそ40〜60件/分の想定流量なので、500件で10分前後を
 * 遡れる。これは「今の環境の観測数」から導いた閾値ではなく表示上の保持窓で
 * あり、環境が変わっても静かに壊れる性質のものではない（溢れた分が早く
 * 流れるだけ）。値を変える場合はこの前提を見直すこと。
 */
export const COMMS_LOG_RETENTION = 500;

/** 新しい順（先頭 = 最新）を保ったまま、保持上限を超えた古い方を切り捨てる。 */
function capCommsLog(entries: CommsLogEntry[]): CommsLogEntry[] {
  return entries.length > COMMS_LOG_RETENTION
    ? entries.slice(0, COMMS_LOG_RETENTION)
    : entries;
}

export interface UseCommsLogResult {
  /** 蓄積済みの全エントリ（フィルタ適用前。新しい順）。 */
  entries: CommsLogEntry[];
  /** フィルタ適用後のエントリ（パネル表示にはこちらを使う）。 */
  visibleEntries: CommsLogEntry[];
  filters: CommsLogFilterState;
  toggleCategory: (category: CommsLogCategory) => void;
  setNodeFilter: (nodeId: string | null) => void;
  /** `useWorldState`（`useCommands` 経由）へ渡す差分観測コールバック。 */
  observeDiff: DiffObserver;
  /**
   * 接続状態（`ConnectionStatus`）の変化を通知する。`useWorldState` が返す
   * `status` を呼び出し側が `useEffect` で監視し、変化のたびに呼ぶ想定
   * （`status` は `useCommsLog` 自身の外で管理されているため引数で受け取る。
   * 設計メモ §7.1「スナップショット適用ではエントリを生成しない。代わりに
   * 接続ステータス変化を環境エントリとして記録する」）。
   */
  noteConnectionStatus: (status: ConnectionStatus) => void;
}

/**
 * 通信ログの常駐フック（Issue #317）。App 層でパネルの開閉と無関係に
 * 1インスタンスだけマウントし、Context 等でパネル側へ値を渡す想定
 * （設計メモ §4「ログ蓄積フックはパネルの開閉と無関係に常駐させること」）。
 *
 * `validNodeWorkbenchIds` は現存する node/workbench の entity id 集合。
 * ノードフィルタの対象が削除された場合に自動で「すべて」へ戻すために使う
 * （設計メモ §5.4）。呼び出し側は内容が変わらない限り同じ参照を保つこと
 * （毎レンダー新規 Set を渡すと、この自動リセット用の effect が無駄に
 * 走るだけで実害は無いが、`useMemo` で安定させる方が望ましい）。
 */
export function useCommsLog(
  validNodeWorkbenchIds: ReadonlySet<string>,
): UseCommsLogResult {
  const [entries, setEntries] = useState<CommsLogEntry[]>([]);
  const [filters, setFilters] = useState<CommsLogFilterState>(defaultCommsLogFilterState);

  const appendEntries = useCallback((batch: CommsLogEntry[]) => {
    if (batch.length === 0) return;
    // batch は導出時点で新しい順（timestamp 降順）に揃っているため、
    // そのまま先頭へ連結すれば全体としても新しい順が保たれる。
    setEntries((current) => capCommsLog([...batch, ...current]));
  }, []);

  const observeDiff = useCallback<DiffObserver>(
    (prevState, events, now) => {
      appendEntries(deriveCommsLogEntries(prevState, events, now));
    },
    [appendEntries],
  );

  // 直前に観測した「非 connecting」の接続状態。undefined は「まだ一度も
  // 観測していない（マウント直後の基準確立前）」を表し、この最初の1回は
  // 実際の切断/再接続ではないためログに残さない。
  const prevStatusRef = useRef<ConnectionStatus | undefined>(undefined);
  // 一度でも "connected" を観測したことがあるか。マウント直後の初期状態は
  // 実クライアント・モックとも "disconnected" から始まる（`useWorldState`
  // の初期 state）ため、これを追わずに「prev === "disconnected" →
  // status === "connected" なら再接続」とだけ判定すると、アプリ起動直後の
  // 最初の接続確立まで「再接続した」と誤記録してしまう。実際に一度
  // "connected" を経験した後の disconnected → connected だけを再接続とする。
  const hasConnectedRef = useRef(false);
  const noteConnectionStatus = useCallback(
    (status: ConnectionStatus) => {
      if (status === "connecting") return; // 遷移の途中状態は基準にしない
      const prev = prevStatusRef.current;
      if (prev === undefined) {
        prevStatusRef.current = status;
        if (status === "connected") hasConnectedRef.current = true;
        return;
      }
      if (prev === status) return;

      const now = Date.now();
      if (status === "disconnected" && prev === "connected") {
        appendEntries([
          {
            id: `environment-collector-disconnected-${now}`,
            category: "environment",
            timestamp: now,
            actorIds: [],
            change: "collectorDisconnected",
          },
        ]);
      } else if (status === "connected") {
        if (prev === "disconnected" && hasConnectedRef.current) {
          appendEntries([
            {
              id: `environment-collector-reconnected-${now}`,
              category: "environment",
              timestamp: now,
              actorIds: [],
              change: "collectorReconnected",
            },
          ]);
        }
        hasConnectedRef.current = true;
      }
      prevStatusRef.current = status;
    },
    [appendEntries],
  );

  const toggleCategory = useCallback((category: CommsLogCategory) => {
    setFilters((current) => toggleCommsLogCategory(current, category));
  }, []);

  const setNodeFilter = useCallback((nodeId: string | null) => {
    setFilters((current) => ({ ...current, nodeId }));
  }, []);

  // 選択中のノードフィルタが削除済みになったら「すべて」へ戻す（設計メモ §5.4）。
  useEffect(() => {
    setFilters((current) => {
      if (current.nodeId === null) return current;
      if (validNodeWorkbenchIds.has(current.nodeId)) return current;
      return { ...current, nodeId: null };
    });
  }, [validNodeWorkbenchIds]);

  const visibleEntries = useMemo(
    () => applyCommsLogFilter(entries, filters),
    [entries, filters],
  );

  return {
    entries,
    visibleEntries,
    filters,
    toggleCategory,
    setNodeFilter,
    observeDiff,
    noteConnectionStatus,
  };
}
