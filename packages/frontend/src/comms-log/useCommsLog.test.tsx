import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { COMMS_LOG_RETENTION, useCommsLog } from "./useCommsLog.js";
import { testNode, testWorkbench } from "./testFixtures.js";
import type { WorldState } from "../world-state/store.js";

afterEach(cleanup);

const emptyState: WorldState = { entities: {}, edges: [] };

describe("useCommsLog: accumulation via observeDiff", () => {
  it("starts with no entries", () => {
    const { result } = renderHook(() => useCommsLog());
    expect(result.current.entries).toEqual([]);
    expect(result.current.visibleEntries).toEqual([]);
  });

  it("accumulates entries derived from observed diffs, newest first", () => {
    const { result } = renderHook(() => useCommsLog());

    act(() => {
      result.current.observeDiff(
        emptyState,
        [{ type: "entityAdded", entity: testNode({ id: "reth-1", containerName: "chainviz-reth-1" }) }],
        1_000,
      );
    });
    act(() => {
      result.current.observeDiff(
        emptyState,
        [{ type: "entityAdded", entity: testWorkbench({ id: "wb-1", label: "Alice" }) }],
        2_000,
      );
    });

    expect(result.current.entries).toHaveLength(2);
    // 2件目(あとから observeDiff された環境イベント)が先頭に来る。
    expect(result.current.entries[0]).toMatchObject({ change: "workbenchAdded" });
    expect(result.current.entries[1]).toMatchObject({ change: "nodeAdded" });
  });

  it("keeps accumulating regardless of how the panel/filter is used (no dependency on visibility)", () => {
    const { result } = renderHook(() => useCommsLog());
    act(() => {
      result.current.toggleCategory("environment"); // カテゴリを off にしても
    });
    act(() => {
      result.current.observeDiff(
        emptyState,
        [{ type: "entityAdded", entity: testNode({ id: "reth-1" }) }],
        1_000,
      );
    });
    expect(result.current.entries).toHaveLength(1); // 蓄積自体は続く
    expect(result.current.visibleEntries).toHaveLength(0); // 表示だけ絞られる
  });

  it("caps retained entries at COMMS_LOG_RETENTION, dropping the oldest", () => {
    const { result } = renderHook(() => useCommsLog());

    act(() => {
      for (let i = 0; i < COMMS_LOG_RETENTION + 10; i += 1) {
        result.current.observeDiff(
          emptyState,
          [{ type: "entityAdded", entity: testNode({ id: `reth-${i}` }) }],
          i,
        );
      }
    });

    expect(result.current.entries).toHaveLength(COMMS_LOG_RETENTION);
    // 最新(最後に追加した reth-<N+9>)が先頭に残り、最古の10件が捨てられている。
    expect(result.current.entries[0]).toMatchObject({ subjectId: `reth-${COMMS_LOG_RETENTION + 9}` });
    expect(result.current.entries.at(-1)).toMatchObject({ subjectId: "reth-10" });
  });
});

describe("useCommsLog: filters", () => {
  it("toggleCategory flips visibility for that category only", () => {
    const { result } = renderHook(() => useCommsLog());
    expect(result.current.filters.categories.tx).toBe(true);
    act(() => result.current.toggleCategory("tx"));
    expect(result.current.filters.categories.tx).toBe(false);
    expect(result.current.filters.categories.block).toBe(true);
  });

  it("setNodeFilter narrows visibleEntries to matching actorIds", () => {
    const { result } = renderHook(() => useCommsLog());
    act(() => {
      result.current.observeDiff(
        emptyState,
        [
          {
            type: "edgeAdded",
            edge: { kind: "peer", fromNodeId: "reth-1", toNodeId: "reth-2", networkId: "1337" },
          },
          {
            type: "edgeAdded",
            edge: { kind: "peer", fromNodeId: "reth-3", toNodeId: "reth-4", networkId: "1337" },
          },
        ],
        1_000,
      );
    });
    expect(result.current.visibleEntries).toHaveLength(2);

    act(() => result.current.setNodeFilter("reth-1"));
    expect(result.current.visibleEntries).toHaveLength(1);
    expect(result.current.visibleEntries[0]).toMatchObject({ fromNodeId: "reth-1" });
  });

  it("resets the node filter to 'all' once the selected node/workbench is no longer valid", () => {
    const { result } = renderHook(() => useCommsLog());
    act(() => {
      result.current.syncValidNodeWorkbenchIds(new Set(["reth-1"]));
      result.current.setNodeFilter("reth-1");
    });
    expect(result.current.filters.nodeId).toBe("reth-1");

    act(() => result.current.syncValidNodeWorkbenchIds(new Set())); // reth-1 が削除された
    expect(result.current.filters.nodeId).toBeNull();
  });

  it("keeps the node filter untouched while it still refers to a valid node", () => {
    const { result } = renderHook(() => useCommsLog());
    act(() => {
      result.current.syncValidNodeWorkbenchIds(new Set(["reth-1", "reth-2"]));
      result.current.setNodeFilter("reth-1");
    });
    act(() => result.current.syncValidNodeWorkbenchIds(new Set(["reth-1", "reth-2", "reth-3"])));
    expect(result.current.filters.nodeId).toBe("reth-1");
  });
});

describe("useCommsLog: noteConnectionStatus", () => {
  it("does not log anything for the very first status observed (baseline, not a real transition)", () => {
    const { result } = renderHook(() => useCommsLog());
    act(() => result.current.noteConnectionStatus("connected"));
    expect(result.current.entries).toEqual([]);
  });

  it("does not log the initial connecting -> connected sequence", () => {
    const { result } = renderHook(() => useCommsLog());
    act(() => {
      result.current.noteConnectionStatus("disconnected");
      result.current.noteConnectionStatus("connecting");
      result.current.noteConnectionStatus("connected");
    });
    expect(result.current.entries).toEqual([]);
  });

  it("logs a disconnection when transitioning from connected to disconnected", () => {
    const { result } = renderHook(() => useCommsLog());
    act(() => {
      result.current.noteConnectionStatus("connected"); // baseline
      result.current.noteConnectionStatus("disconnected");
    });
    expect(result.current.entries).toEqual([
      expect.objectContaining({ category: "environment", change: "collectorDisconnected" }),
    ]);
  });

  it("logs a reconnection when transitioning from disconnected back to connected (through connecting)", () => {
    const { result } = renderHook(() => useCommsLog());
    act(() => {
      result.current.noteConnectionStatus("connected"); // baseline
      result.current.noteConnectionStatus("disconnected");
      result.current.noteConnectionStatus("connecting");
      result.current.noteConnectionStatus("connected");
    });
    expect(result.current.entries.map((entry) => (entry.category === "environment" ? entry.change : null))).toEqual(
      ["collectorReconnected", "collectorDisconnected"],
    );
  });

  it("does not log a redundant call with the same status twice in a row", () => {
    const { result } = renderHook(() => useCommsLog());
    act(() => {
      result.current.noteConnectionStatus("connected");
      result.current.noteConnectionStatus("disconnected");
      result.current.noteConnectionStatus("disconnected");
    });
    expect(result.current.entries).toHaveLength(1);
  });
});
