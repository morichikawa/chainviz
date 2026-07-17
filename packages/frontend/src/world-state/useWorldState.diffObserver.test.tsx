// useWorldState の onDiffEvents（DiffObserver。Issue #317）専用のテスト。
// 既存の useWorldState.test.tsx（コマンド配線・hasReceivedSnapshot・
// nodeLinkActivities チャンネル）とは関心事が異なるため別ファイルに分ける
// (CLAUDE.md「1ファイル1責務をテストファイルにも適用する」)。

import type { WorldStateSnapshot } from "@chainviz/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChainvizClient, ChainvizClientHandlers } from "../websocket/client.js";
import { type ClientFactory, useWorldState } from "./useWorldState.js";

function fakeClient(handlers: ChainvizClientHandlers) {
  const client: ChainvizClient = {
    connect() {},
    disconnect() {},
    sendCommand: () => "cmd-1",
    getStatus: () => "connected",
  };
  return { client, handlers };
}

afterEach(cleanup);

describe("useWorldState onDiffEvents (Issue #317)", () => {
  it("is not called for the initial snapshot", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers) => {
      captured = handlers;
      return fakeClient(handlers).client;
    };
    const onDiffEvents = vi.fn();
    renderHook(() => useWorldState(factory, undefined, onDiffEvents));

    const snapshot: WorldStateSnapshot = {
      chainType: "ethereum",
      timestamp: 0,
      entities: [],
      edges: [],
    };
    act(() => {
      captured?.onSnapshot?.(snapshot);
    });

    expect(onDiffEvents).not.toHaveBeenCalled();
  });

  it("is called once per onDiff with the state from before this diff was applied", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers) => {
      captured = handlers;
      return fakeClient(handlers).client;
    };
    const onDiffEvents = vi.fn();
    renderHook(() => useWorldState(factory, undefined, onDiffEvents));

    const firstEvents = [
      {
        type: "entityAdded" as const,
        entity: {
          kind: "node" as const,
          id: "reth-1",
          containerName: "chainviz-reth-1",
          ip: "172.20.0.10",
          ports: [8545],
          resources: { cpuPercent: 1, memMB: 100 },
          process: { name: "reth" },
          chainType: "ethereum" as const,
          clientType: "reth",
          syncStatus: "synced" as const,
          blockHeight: 0,
          headBlockHash: "",
        },
      },
    ];
    act(() => {
      captured?.onDiff?.(firstEvents);
    });

    expect(onDiffEvents).toHaveBeenCalledTimes(1);
    const [prevState1, events1] = onDiffEvents.mock.calls[0];
    expect(prevState1).toEqual({ entities: {}, edges: [] });
    expect(events1).toBe(firstEvents);

    const secondEvents = [{ type: "entityRemoved" as const, id: "reth-1" }];
    act(() => {
      captured?.onDiff?.(secondEvents);
    });

    expect(onDiffEvents).toHaveBeenCalledTimes(2);
    const [prevState2] = onDiffEvents.mock.calls[1];
    // 2回目に渡される prevState は、1回目の diff 適用後の状態
    // (reth-1 が存在する状態) でなければならない。
    expect(Object.keys(prevState2.entities)).toEqual(["reth-1"]);
  });

  it("passes a numeric `now` timestamp to onDiffEvents", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers) => {
      captured = handlers;
      return fakeClient(handlers).client;
    };
    const onDiffEvents = vi.fn();
    renderHook(() => useWorldState(factory, undefined, onDiffEvents));

    act(() => {
      captured?.onDiff?.([{ type: "entityRemoved", id: "ghost" }]);
    });

    const [, , now] = onDiffEvents.mock.calls[0];
    expect(typeof now).toBe("number");
  });

  it("does not throw when onDiffEvents is omitted (optional callback)", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers) => {
      captured = handlers;
      return fakeClient(handlers).client;
    };
    renderHook(() => useWorldState(factory));

    expect(() => {
      act(() => {
        captured?.onDiff?.([{ type: "entityRemoved", id: "ghost" }]);
      });
    }).not.toThrow();
  });

  it("still applies the diff to state even while onDiffEvents is wired (no regression)", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers) => {
      captured = handlers;
      return fakeClient(handlers).client;
    };
    const onDiffEvents = vi.fn();
    const { result } = renderHook(() => useWorldState(factory, undefined, onDiffEvents));

    act(() => {
      captured?.onDiff?.([
        {
          type: "entityAdded",
          entity: {
            kind: "node",
            id: "reth-1",
            containerName: "chainviz-reth-1",
            ip: "172.20.0.10",
            ports: [8545],
            resources: { cpuPercent: 1, memMB: 100 },
            process: { name: "reth" },
            chainType: "ethereum",
            clientType: "reth",
            syncStatus: "synced",
            blockHeight: 0,
            headBlockHash: "",
          },
        },
      ]);
    });

    expect(Object.keys(result.current.state.entities)).toEqual(["reth-1"]);
  });
});
