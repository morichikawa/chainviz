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

/**
 * `useCommands.ts` の removeNode/removeWorkbench 保留追跡
 * （`pendingRemovalIds`。Issue #222）に絞ったテスト。既存の
 * useCommandsWorkbenchOperations.test.tsx と同じ構成（対象ロジックごとに
 * ファイルを分ける方針、Issue #167）に倣う。
 */

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
  };
}

afterEach(cleanup);

describe("useCommands: removeNode pending tracking (Issue #222)", () => {
  it("marks the node pending immediately after dispatch", () => {
    const { result } = setup();
    act(() => {
      result.current.actions.removeNode("reth-follower-1");
    });
    expect(result.current.pendingRemovalIds.has("reth-follower-1")).toBe(true);
  });

  it("clears the pending flag once commandResult(ok:true) arrives", () => {
    const { result, resolve } = setup();
    act(() => {
      result.current.actions.removeNode("reth-follower-1");
    });
    resolve(0, true);
    expect(result.current.pendingRemovalIds.has("reth-follower-1")).toBe(false);
  });

  it("clears the pending flag on commandResult(ok:false) too (rejected removal still resolves)", () => {
    const { result, resolve } = setup();
    act(() => {
      result.current.actions.removeNode("validator-1");
    });
    resolve(0, false, "cannot remove a validator node started by compose");
    expect(result.current.pendingRemovalIds.has("validator-1")).toBe(false);
  });

  it("notifies an error on rejected removal, same as other commands", () => {
    const { result, resolve, notify } = setup();
    act(() => {
      result.current.actions.removeNode("validator-1");
    });
    resolve(0, false, "cannot remove a validator node started by compose");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "error" }),
    );
  });
});

describe("useCommands: removeWorkbench pending tracking (Issue #222)", () => {
  it("marks the workbench pending immediately after dispatch", () => {
    const { result } = setup();
    act(() => {
      result.current.actions.removeWorkbench("workbench-alice");
    });
    expect(result.current.pendingRemovalIds.has("workbench-alice")).toBe(true);
  });

  it("clears the pending flag once commandResult(ok:true) arrives", () => {
    const { result, resolve } = setup();
    act(() => {
      result.current.actions.removeWorkbench("workbench-alice");
    });
    resolve(0, true);
    expect(result.current.pendingRemovalIds.has("workbench-alice")).toBe(false);
  });

  it("tracks pending state independently per id, and across nodes/workbenches (shared id space)", () => {
    const { result, resolve } = setup();
    act(() => {
      result.current.actions.removeNode("reth-follower-1");
      result.current.actions.removeWorkbench("workbench-alice");
    });
    expect(result.current.pendingRemovalIds.has("reth-follower-1")).toBe(true);
    expect(result.current.pendingRemovalIds.has("workbench-alice")).toBe(true);

    resolve(0, true);
    expect(result.current.pendingRemovalIds.has("reth-follower-1")).toBe(false);
    expect(result.current.pendingRemovalIds.has("workbench-alice")).toBe(true);

    resolve(1, true);
    expect(result.current.pendingRemovalIds.has("workbench-alice")).toBe(false);
  });

  it("keeps the id pending until every in-flight removal for it resolves (no double-submit guard, same as runWorkbenchOperation)", () => {
    const { result, resolve } = setup();
    act(() => {
      result.current.actions.removeNode("reth-follower-1");
      result.current.actions.removeNode("reth-follower-1");
    });
    resolve(0, true);
    // 2件目がまだ保留中なので pending は維持される。
    expect(result.current.pendingRemovalIds.has("reth-follower-1")).toBe(true);
    resolve(1, true);
    expect(result.current.pendingRemovalIds.has("reth-follower-1")).toBe(false);
  });
});
