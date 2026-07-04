import type { Command } from "@chainviz/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { translate } from "../i18n/i18n.js";
import type { MessageKey } from "../i18n/messages.js";
import type {
  ChainvizClient,
  ChainvizClientHandlers,
} from "../websocket/client.js";
import type { ClientFactory } from "../world-state/useWorldState.js";
import { useCommands } from "./useCommands.js";

const t = (key: MessageKey) => translate(key, "en");

function setup() {
  let handlers: ChainvizClientHandlers | null = null;
  const sent: Command[] = [];
  const commandIds: string[] = [];
  let counter = 0;

  const factory: ClientFactory = (h): ChainvizClient => {
    handlers = h;
    return {
      connect() {},
      disconnect() {},
      sendCommand(command) {
        const id = `cmd-${++counter}`;
        sent.push(command);
        commandIds.push(id);
        return id;
      },
      getStatus: () => "connected",
    };
  };

  const notify = vi.fn();
  const view = renderHook(() => useCommands(factory, notify, t));
  return {
    ...view,
    notify,
    sent,
    commandIds,
    resolve: (commandIndex: number, ok: boolean, error?: string) =>
      act(() => {
        handlers?.onCommandResult?.(commandIds[commandIndex], ok, error);
      }),
    resolveById: (commandId: string, ok: boolean, error?: string) =>
      act(() => {
        handlers?.onCommandResult?.(commandId, ok, error);
      }),
  };
}

afterEach(cleanup);

describe("useCommands", () => {
  it("sends addNode with the default chain profile", () => {
    const { result, sent } = setup();
    act(() => result.current.actions.addNode());
    expect(sent).toEqual([{ action: "addNode", chainProfile: "ethereum" }]);
  });

  it("sends removeNode / removeWorkbench with the given ids", () => {
    const { result, sent } = setup();
    act(() => result.current.actions.removeNode("reth-follower-1"));
    act(() => result.current.actions.removeWorkbench("workbench-1"));
    expect(sent).toEqual([
      { action: "removeNode", nodeId: "reth-follower-1" },
      { action: "removeWorkbench", workbenchId: "workbench-1" },
    ]);
  });

  it("normalizes the workbench label before sending", () => {
    const { result, sent } = setup();
    act(() => result.current.actions.addWorkbench("  Bob  "));
    act(() => result.current.actions.addWorkbench("   "));
    expect(sent).toEqual([
      { action: "addWorkbench", label: "Bob" },
      { action: "addWorkbench", label: "workbench" },
    ]);
  });

  it("notifies with a descriptive error when a command fails", () => {
    const { result, notify, resolve } = setup();
    act(() => result.current.actions.removeNode("reth-node-1"));
    resolve(0, false, "cannot remove a validator node");

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to remove node: cannot remove a validator node",
    });
  });

  it("does not notify when a command succeeds", () => {
    const { result, notify, resolve } = setup();
    act(() => result.current.actions.addNode());
    resolve(0, true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("maps each result to the command that produced it", () => {
    const { result, notify, resolve } = setup();
    act(() => result.current.actions.addWorkbench("Bob"));
    act(() => result.current.actions.removeNode("reth-node-1"));

    // 2番目に送ったコマンド（removeNode）が失敗した場合。
    resolve(1, false, "boom");
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to remove node: boom",
    });
  });

  it("notifies only once per command when the same result arrives twice", () => {
    const { result, notify, resolve } = setup();
    act(() => result.current.actions.removeNode("reth-node-1"));

    // 1回目は pending から removeNode を特定して詳細付きで通知。
    resolve(0, false, "boom");
    // 2回目は pending から消えているため command 不明の汎用文言になる。
    resolve(0, false, "boom");

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenNthCalledWith(1, {
      kind: "error",
      message: "Failed to remove node: boom",
    });
    // 2回目は command を特定できないため、詳細は残るが定型文が汎用になる。
    expect(notify).toHaveBeenNthCalledWith(2, {
      kind: "error",
      message: "Command failed: boom",
    });
  });

  it("falls back to a generic message for a stray failure after success", () => {
    const { result, notify, resolve } = setup();
    act(() => result.current.actions.addNode());

    // 成功で pending から除かれた後に、同じ id で遅れて失敗が届いた場合。
    resolve(0, true);
    resolve(0, false, "late failure");

    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Command failed: late failure",
    });
  });

  it("ignores a result for a commandId that was never sent", () => {
    const { notify, resolveById } = setup();
    // 送っていない id に対する成功結果は何も通知しない。
    resolveById("phantom", true);
    expect(notify).not.toHaveBeenCalled();
  });

  it("tracks every command independently when the same action is fired repeatedly", () => {
    const { result, notify, sent, resolve } = setup();
    act(() => result.current.actions.removeNode("reth-node-1"));
    act(() => result.current.actions.removeNode("reth-node-1"));
    act(() => result.current.actions.removeNode("reth-node-1"));

    expect(sent).toHaveLength(3);
    // 3連打のうち2件が失敗した場合、失敗した分だけ通知される。
    resolve(0, false, "boom");
    resolve(2, false, "boom");
    resolve(1, true);

    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("does not notify while a result never arrives", () => {
    const { result, notify } = setup();
    act(() => result.current.actions.addNode());
    // commandResult を送らない限り、pending のまま何も起こらない。
    expect(notify).not.toHaveBeenCalled();
  });
});
