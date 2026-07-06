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
      captured?.onStatusChange("connected");
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
      captured?.onStatusChange("connected");
    });
    expect(result.current.hasReceivedSnapshot).toBe(false);

    act(() => {
      captured?.onSnapshot(emptySnapshot);
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
      captured?.onStatusChange("connected");
      captured?.onSnapshot(emptySnapshot);
    });
    expect(result.current.hasReceivedSnapshot).toBe(true);

    act(() => {
      captured?.onStatusChange("disconnected");
    });
    expect(result.current.hasReceivedSnapshot).toBe(true);
  });
});
