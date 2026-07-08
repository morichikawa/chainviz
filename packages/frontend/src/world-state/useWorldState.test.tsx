import type { Command, WorldStateSnapshot } from "@chainviz/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ChainvizClient,
  ChainvizClientHandlers,
} from "../websocket/client.js";
import { type ClientFactory, useWorldState } from "./useWorldState.js";

function fakeClient(handlers: ChainvizClientHandlers) {
  const sent: Command[] = [];
  let counter = 0;
  const client: ChainvizClient = {
    connect() {},
    disconnect() {},
    sendCommand(command) {
      sent.push(command);
      return `cmd-${++counter}`;
    },
    getStatus: () => "connected",
  };
  return { client, sent, handlers };
}

afterEach(cleanup);

describe("useWorldState command wiring", () => {
  it("delegates sendCommand to the connected client and returns its id", () => {
    const sent: Command[] = [];
    const factory: ClientFactory = (handlers) => {
      const f = fakeClient(handlers);
      f.sent.length = 0;
      return {
        ...f.client,
        sendCommand(command) {
          sent.push(command);
          return "cmd-1";
        },
      };
    };

    const { result } = renderHook(() => useWorldState(factory));

    let id: string | undefined;
    act(() => {
      id = result.current.sendCommand({ action: "addNode", chainProfile: "ethereum" });
    });

    expect(id).toBe("cmd-1");
    expect(sent).toEqual([{ action: "addNode", chainProfile: "ethereum" }]);
  });

  it("forwards commandResult callbacks to onCommandResult", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers) => {
      captured = handlers;
      return fakeClient(handlers).client;
    };
    const onCommandResult = vi.fn();

    renderHook(() => useWorldState(factory, onCommandResult));

    act(() => {
      captured?.onCommandResult?.("cmd-9", false, "nope");
    });

    expect(onCommandResult).toHaveBeenCalledWith("cmd-9", false, "nope");
  });

  it("returns undefined from sendCommand after unmount", () => {
    const factory: ClientFactory = (handlers) => fakeClient(handlers).client;
    const { result, unmount } = renderHook(() => useWorldState(factory));
    const send = result.current.sendCommand;
    unmount();
    expect(send({ action: "removeNode", nodeId: "x" })).toBeUndefined();
  });
});

describe("useWorldState hasReceivedSnapshot (Issue #123 regression)", () => {
  const emptySnapshot: WorldStateSnapshot = {
    chainType: "ethereum",
    timestamp: 0,
    entities: [],
    edges: [],
  };

  it("starts false even after status becomes connected, before a snapshot arrives", () => {
    // 実クライアントの実際の順序: onopen(→status="connected") が先に発火し、
    // スナップショットは別メッセージとして後から届く。この間隙を再現する。
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers) => {
      captured = handlers;
      return fakeClient(handlers).client;
    };

    const { result } = renderHook(() => useWorldState(factory));

    act(() => {
      captured?.onStatusChange?.("connected");
    });

    expect(result.current.status).toBe("connected");
    expect(result.current.hasReceivedSnapshot).toBe(false);
  });

  it("becomes true only once the snapshot message actually arrives", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers) => {
      captured = handlers;
      return fakeClient(handlers).client;
    };

    const { result } = renderHook(() => useWorldState(factory));

    act(() => {
      captured?.onStatusChange?.("connected");
    });
    expect(result.current.hasReceivedSnapshot).toBe(false);

    act(() => {
      captured?.onSnapshot?.(emptySnapshot);
    });
    expect(result.current.hasReceivedSnapshot).toBe(true);
  });

  it("stays true across a later disconnect (does not require re-deriving the baseline)", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers) => {
      captured = handlers;
      return fakeClient(handlers).client;
    };

    const { result } = renderHook(() => useWorldState(factory));

    act(() => {
      captured?.onStatusChange?.("connected");
      captured?.onSnapshot?.(emptySnapshot);
    });
    expect(result.current.hasReceivedSnapshot).toBe(true);

    act(() => {
      captured?.onStatusChange?.("disconnected");
    });
    expect(result.current.hasReceivedSnapshot).toBe(true);
  });
});

describe("useWorldState nodeLinkActivities channel (D層。Issue #188)", () => {
  it("starts empty before any diff arrives", () => {
    const factory: ClientFactory = (handlers) => fakeClient(handlers).client;
    const { result } = renderHook(() => useWorldState(factory));
    expect(result.current.nodeLinkActivities).toEqual([]);
  });

  it("appends a seq-numbered signal for each nodeLinkActivity diff event", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers) => {
      captured = handlers;
      return fakeClient(handlers).client;
    };
    const { result } = renderHook(() => useWorldState(factory));

    act(() => {
      captured?.onDiff?.([
        {
          type: "nodeLinkActivity",
          activity: {
            fromNodeId: "beacon-1",
            toNodeId: "reth-1",
            calls: [{ method: "engine_newPayloadV4", count: 2 }],
            observedAt: 1_000,
          },
        },
      ]);
    });

    expect(result.current.nodeLinkActivities).toHaveLength(1);
    expect(result.current.nodeLinkActivities[0]).toMatchObject({
      seq: 0,
      activity: { fromNodeId: "beacon-1", toNodeId: "reth-1" },
    });
  });

  it("does not fold nodeLinkActivity into the world state entities/edges", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers) => {
      captured = handlers;
      return fakeClient(handlers).client;
    };
    const { result } = renderHook(() => useWorldState(factory));

    act(() => {
      captured?.onDiff?.([
        {
          type: "nodeLinkActivity",
          activity: {
            fromNodeId: "beacon-1",
            toNodeId: "reth-1",
            calls: [],
            observedAt: 1_000,
          },
        },
      ]);
    });

    expect(Object.keys(result.current.state.entities)).toEqual([]);
    expect(result.current.state.edges).toEqual([]);
  });

  it("keeps operations and nodeLinkActivities as independent channels", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers) => {
      captured = handlers;
      return fakeClient(handlers).client;
    };
    const { result } = renderHook(() => useWorldState(factory));

    act(() => {
      captured?.onDiff?.([
        {
          type: "operationObserved",
          edge: {
            kind: "operation",
            fromWorkbenchId: "workbench-alice",
            toNodeId: "reth-node-1",
            operation: "eth_sendRawTransaction",
            observedAt: 1_000,
          },
        },
        {
          type: "nodeLinkActivity",
          activity: {
            fromNodeId: "beacon-1",
            toNodeId: "reth-1",
            calls: [{ method: "engine_newPayloadV4", count: 1 }],
            observedAt: 1_000,
          },
        },
      ]);
    });

    expect(result.current.operations).toHaveLength(1);
    expect(result.current.nodeLinkActivities).toHaveLength(1);
  });

  it("caps the retained nodeLinkActivities to the most recent ones", () => {
    let captured: ChainvizClientHandlers | null = null;
    const factory: ClientFactory = (handlers) => {
      captured = handlers;
      return fakeClient(handlers).client;
    };
    const { result } = renderHook(() => useWorldState(factory));

    const many = Array.from({ length: 150 }, (_, i) => ({
      type: "nodeLinkActivity" as const,
      activity: {
        fromNodeId: "beacon-1",
        toNodeId: "reth-1",
        calls: [{ method: "engine_newPayloadV4", count: 1 }],
        observedAt: i,
      },
    }));

    act(() => {
      captured?.onDiff?.(many);
    });

    expect(result.current.nodeLinkActivities).toHaveLength(100);
    // 直近100件を残す（末尾=最新50件切り捨て前の続き）。最古のseqが50から始まる。
    expect(result.current.nodeLinkActivities[0].seq).toBe(50);
    expect(
      result.current.nodeLinkActivities[result.current.nodeLinkActivities.length - 1]
        .seq,
    ).toBe(149);
  });
});
