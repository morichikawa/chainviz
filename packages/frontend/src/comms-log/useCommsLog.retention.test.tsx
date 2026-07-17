// リングバッファ（保持窓 COMMS_LOG_RETENTION）の境界挙動と、フィルタ適用と
// 蓄積継続の組み合わせに絞ったテスト。基本の蓄積・フィルタ・接続状態は
// useCommsLog.test.tsx にあるため、ここでは上限到達まわりの境界という関心事
// だけを扱う（CLAUDE.md のテスト分割方針・設計メモ §6）。
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { DiffEvent } from "@chainviz/shared";
import type { WorldState } from "../world-state/store.js";
import { COMMS_LOG_RETENTION, useCommsLog } from "./useCommsLog.js";

afterEach(cleanup);

const emptyState: WorldState = { entities: {}, edges: [] };

/** timestamp が seq のノード追加イベントを1件生成する（環境カテゴリ）。 */
function nodeAddedEvent(seq: number): DiffEvent {
  return {
    type: "entityAdded",
    entity: {
      kind: "node",
      id: `reth-${seq}`,
      containerName: `reth-${seq}`,
      ip: "172.20.0.10",
      ports: [8545],
      resources: { cpuPercent: 1, memMB: 256 },
      process: { name: "node" },
      chainType: "ethereum",
      clientType: "reth",
      syncStatus: "synced",
      blockHeight: 0,
      headBlockHash: "",
    },
  };
}

describe("useCommsLog: ring buffer boundaries", () => {
  it("keeps exactly COMMS_LOG_RETENTION entries without dropping when the count lands on the limit", () => {
    const { result } = renderHook(() => useCommsLog());
    act(() => {
      for (let i = 0; i < COMMS_LOG_RETENTION; i += 1) {
        result.current.observeDiff(emptyState, [nodeAddedEvent(i)], i);
      }
    });
    expect(result.current.entries).toHaveLength(COMMS_LOG_RETENTION);
    // 最古（seq 0）がまだ残っている（1件も落ちていない境界）。
    expect(result.current.entries.at(-1)).toMatchObject({ subjectId: "reth-0" });
  });

  it("caps a single oversized batch (more than the limit in one observeDiff) to the newest RETENTION entries", () => {
    const { result } = renderHook(() => useCommsLog());
    // 1回の observeDiff で上限超えの件数を一気に流す。バッチ内は全て同一
    // timestamp なので導出時の安定ソートで push 順が保たれ、先頭 RETENTION
    // 件が残る。
    const batch: DiffEvent[] = [];
    for (let i = 0; i < COMMS_LOG_RETENTION + 25; i += 1) batch.push(nodeAddedEvent(i));

    act(() => {
      result.current.observeDiff(emptyState, batch, 1_000);
    });

    expect(result.current.entries).toHaveLength(COMMS_LOG_RETENTION);
  });

  it("does nothing (no throw, no change) for an empty events batch", () => {
    const { result } = renderHook(() => useCommsLog());
    act(() => {
      result.current.observeDiff(emptyState, [], 1_000);
    });
    expect(result.current.entries).toEqual([]);
  });
});

describe("useCommsLog: filter + accumulation combined with retention", () => {
  it("keeps accumulating (and capping) even while a category is filtered out of view", () => {
    const { result } = renderHook(() => useCommsLog());
    act(() => {
      result.current.toggleCategory("environment"); // 表示から environment を外す
    });

    act(() => {
      for (let i = 0; i < COMMS_LOG_RETENTION + 30; i += 1) {
        result.current.observeDiff(emptyState, [nodeAddedEvent(i)], i);
      }
    });

    // 蓄積は上限まで続き（表示フィルタは蓄積に影響しない）、
    expect(result.current.entries).toHaveLength(COMMS_LOG_RETENTION);
    // 一方で environment を外しているので表示は空。
    expect(result.current.visibleEntries).toHaveLength(0);

    // フィルタを戻すと、蓄積済みの上限ぶんが一気に見えるようになる。
    act(() => result.current.toggleCategory("environment"));
    expect(result.current.visibleEntries).toHaveLength(COMMS_LOG_RETENTION);
  });
});
