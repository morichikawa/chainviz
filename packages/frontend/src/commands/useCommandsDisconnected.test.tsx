import type { Command } from "@chainviz/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "../i18n/i18n.js";
import type { MessageKey } from "../i18n/messages.js";
import { GHOST_TIMEOUT_MS } from "../entities/ghostNode.js";
import type {
  ChainvizClient,
  ChainvizClientHandlers,
} from "../websocket/client.js";
import type { ClientFactory } from "../world-state/useWorldState.js";
import { useCommands } from "./useCommands.js";

/**
 * `useCommands.ts` の「WebSocket 未接続でコマンドがそもそも送れなかった」
 * 送信失敗経路（Issue #235）に絞ったテスト。ゴーストの安全網タイムアウトに
 * よる失敗通知は関心が別（コマンドは送れたが応答が返らないケース）なので
 * `useCommandsGhostTimeout.test.tsx` に分けている。既存の
 * `useCommandsPendingRemoval.test.tsx` と同じ構成（対象ロジックごとに
 * ファイルを分ける方針、Issue #167）に倣う。
 *
 * `sendCommand` の戻り値を呼び出しごとに差し替えられるようにし、
 * `ChainvizClient.sendCommand` が未接続時に `undefined` を返す（Issue #235
 * の client.ts の修正）ケースをモックで再現する。
 */

const t = (key: MessageKey) => translate(key, "en");

function setup() {
  let handlers: ChainvizClientHandlers | null = null;
  const sent: Command[] = [];
  const commandIds: (string | undefined)[] = [];
  let counter = 0;
  // true の間は sendCommand が undefined を返す（未接続を模す）。
  let disconnected = false;

  const factory: ClientFactory = (h): ChainvizClient => {
    handlers = h;
    return {
      connect() {},
      disconnect() {},
      sendCommand(command) {
        if (disconnected) {
          commandIds.push(undefined);
          return undefined;
        }
        const id = `cmd-${++counter}`;
        sent.push(command);
        commandIds.push(id);
        return id;
      },
      getStatus: () => (disconnected ? "disconnected" : "connected"),
    };
  };

  const notify = vi.fn();
  const view = renderHook(() => useCommands(factory, notify, t));
  return {
    ...view,
    notify,
    sent,
    setDisconnected: (value: boolean) => {
      disconnected = value;
    },
    resolve: (commandIndex: number, ok: boolean, error?: string) =>
      act(() => {
        handlers?.onCommandResult?.(commandIds[commandIndex] as string, ok, error);
      }),
  };
}

afterEach(cleanup);

describe("useCommands: sendCommand returns undefined (WebSocket not connected, Issue #235)", () => {
  it("shows an error toast immediately and creates no ghost when addNode fails to send", () => {
    const { result, notify, setDisconnected } = setup();
    setDisconnected(true);

    act(() => result.current.actions.addNode());

    expect(result.current.ghosts).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to add node: Not connected to the collector",
    });
  });

  it("shows an error toast immediately and creates no ghost when addWorkbench fails to send", () => {
    const { result, notify, setDisconnected } = setup();
    setDisconnected(true);

    act(() => result.current.actions.addWorkbench("Bob"));

    expect(result.current.ghosts).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to add workbench: Not connected to the collector",
    });
  });

  it("shows an error toast for removeNode without leaving pendingRemovalIds stuck", () => {
    const { result, notify, setDisconnected } = setup();
    setDisconnected(true);

    act(() => result.current.actions.removeNode("reth-1"));

    expect(result.current.pendingRemovalIds.has("reth-1")).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to remove node: Not connected to the collector",
    });
  });

  it("shows an error toast for removeWorkbench without leaving pendingRemovalIds stuck", () => {
    const { result, notify, setDisconnected } = setup();
    setDisconnected(true);

    act(() => result.current.actions.removeWorkbench("wb-1"));

    expect(result.current.pendingRemovalIds.has("wb-1")).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to remove workbench: Not connected to the collector",
    });
  });

  it("shows an error toast for runWorkbenchOperation without leaving pendingOperationWorkbenchIds stuck", () => {
    const { result, notify, setDisconnected } = setup();
    setDisconnected(true);

    act(() =>
      result.current.actions.runWorkbenchOperation("wb-1", {
        type: "transfer",
        to: "0xabc",
        amount: "1",
      }),
    );

    expect(result.current.pendingOperationWorkbenchIds.has("wb-1")).toBe(false);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to run workbench operation: Not connected to the collector",
    });
  });

  it("resumes normal dispatch (ghost + pending tracking) once connected again", () => {
    const { result, notify, sent, setDisconnected } = setup();
    setDisconnected(true);
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(0);

    setDisconnected(false);
    act(() => result.current.actions.addNode());

    expect(sent).toEqual([{ action: "addNode", chainProfile: "ethereum" }]);
    expect(result.current.ghosts).toHaveLength(2);
    // 未接続時の1件だけがエラー通知されている。
    expect(notify).toHaveBeenCalledTimes(1);
  });
});

describe("useCommands: repeated / mixed dispatch while disconnected (Issue #235)", () => {
  it("notifies once per command when several commands are sent in a row while disconnected", () => {
    const { result, notify, setDisconnected } = setup();
    setDisconnected(true);

    act(() => {
      result.current.actions.addNode();
      result.current.actions.addNode();
      result.current.actions.addNode();
    });

    // 連打しても1件ずつ確実に通知され、ゴーストは1枚も生まれない。
    expect(result.current.ghosts).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(3);
    for (const call of notify.mock.calls) {
      expect(call[0]).toEqual({
        kind: "error",
        message: "Failed to add node: Not connected to the collector",
      });
    }
  });

  it("uses the right reason per command type for a mixed disconnected batch", () => {
    const { result, notify, setDisconnected } = setup();
    setDisconnected(true);

    act(() => {
      result.current.actions.addNode();
      result.current.actions.addWorkbench("Bob");
      result.current.actions.removeNode("reth-1");
    });

    expect(result.current.ghosts).toHaveLength(0);
    expect(result.current.pendingRemovalIds.size).toBe(0);
    expect(notify).toHaveBeenCalledTimes(3);
    const messages = notify.mock.calls.map((call) => call[0].message);
    expect(messages).toEqual([
      "Failed to add node: Not connected to the collector",
      "Failed to add workbench: Not connected to the collector",
      "Failed to remove node: Not connected to the collector",
    ]);
  });

  it("does not disturb an in-flight ghost when a later command is sent after disconnecting", () => {
    const { result, notify, sent, setDisconnected } = setup();
    // まず接続中に addNode（ゴースト2枚 + pending 記録）。
    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(2);

    // その直後に切断され、次の addNode は即失敗する。
    setDisconnected(true);
    act(() => result.current.actions.addNode());

    // 先行して飛んでいたゴーストは影響を受けず残り、送信済みは1件のまま。
    expect(result.current.ghosts).toHaveLength(2);
    expect(sent).toHaveLength(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to add node: Not connected to the collector",
    });
  });
});

describe("useCommands: the not-connected path does not also fire the ghost timeout (Issue #235)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("notifies exactly once even after GHOST_TIMEOUT_MS elapses (no ghost, so no timer)", () => {
    vi.useFakeTimers();
    const { result, notify, setDisconnected } = setup();
    setDisconnected(true);

    act(() => result.current.actions.addNode());
    expect(notify).toHaveBeenCalledTimes(1);

    // 未接続経路ではゴーストを作らないため安全網タイマーも張られない。
    // 十分に時間を進めても、タイムアウト由来の2件目の通知は出ない。
    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS * 2));

    expect(result.current.ghosts).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
  });
});
