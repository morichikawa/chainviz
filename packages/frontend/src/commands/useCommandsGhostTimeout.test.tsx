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
 * `useCommands.ts` のゴースト安全網タイムアウト（`GHOST_TIMEOUT_MS`）による
 * 失敗通知（Issue #235）に絞ったテスト。ここではコマンド自体は送れている
 * （接続済み）が commandResult も実エンティティも返らない、という遅延失敗の
 * 経路と、逆に既に解決済み（ok:true / ok:false）のゴーストがタイムアウトで
 * 誤って再通知されないことを検証する。未接続で送信自体が失敗する経路は
 * 関心が別なので `useCommandsDisconnected.test.tsx` に分けている（Issue
 * #167 の「対象ロジックごとにファイルを分ける」方針）。
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
    resolve: (commandIndex: number, ok: boolean, error?: string) =>
      act(() => {
        handlers?.onCommandResult?.(commandIds[commandIndex], ok, error);
      }),
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useCommands: ghost safety-net timeout notifies a failure (Issue #235)", () => {
  it("notifies once (not twice) when addNode's two ghosts both time out with no response", () => {
    vi.useFakeTimers();
    const { result, notify } = setup();

    act(() => result.current.actions.addNode());
    expect(result.current.ghosts).toHaveLength(2);
    expect(notify).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS));

    // addNode は EL/CL の2枚のゴーストを同じ commandId で生むが、通知は
    // 1件だけ（2枚のタイマーが両方発火しても pendingRef は最初の発火で
    // 消えるため）。
    expect(result.current.ghosts).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to add node: No response (timed out)",
    });
  });

  it("notifies with the workbench-specific reason when addWorkbench times out", () => {
    vi.useFakeTimers();
    const { result, notify } = setup();

    act(() => result.current.actions.addWorkbench("Bob"));
    expect(result.current.ghosts).toHaveLength(1);

    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS));

    expect(result.current.ghosts).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to add workbench: No response (timed out)",
    });
  });

  it("does not notify when a resolved (ok:true) workbench ghost times out", () => {
    vi.useFakeTimers();
    const { result, notify, resolve } = setup();

    act(() => result.current.actions.addWorkbench("Bob"));
    resolve(0, true);
    expect(result.current.ghosts).toHaveLength(1); // 成功なので実体到着待ち

    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS * 2));
    // 成功済みなのでタイムアウト起因の通知は出ず、ゴーストは黙って消える。
    expect(notify).not.toHaveBeenCalled();
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("does not notify when addNode's two ghosts time out after ok:true (slow container start)", () => {
    vi.useFakeTimers();
    const { result, notify, resolve } = setup();

    act(() => result.current.actions.addNode());
    resolve(0, true); // commandResult は成功。実エンティティ（diff）はまだ来ない。
    expect(result.current.ghosts).toHaveLength(2);

    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS * 2));
    // 起動が遅いだけ（成功済み）なので、2枚とも黙って消え通知は一切出ない。
    expect(notify).not.toHaveBeenCalled();
    expect(result.current.ghosts).toHaveLength(0);
  });

  it("does not double-notify when a ghost fails via ok:false and the timeout would otherwise fire", () => {
    vi.useFakeTimers();
    const { result, notify, resolve } = setup();

    act(() => result.current.actions.addNode());
    // 失敗が確定（ok:false）→ ゴーストは即消え、失敗トーストが1件出る。
    resolve(0, false, "boom");
    expect(result.current.ghosts).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to add node: boom",
    });

    // その後タイムアウト時刻に達しても、既に解決済みなので再通知しない。
    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS * 2));
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("only times out the unresolved command when two are in flight (per-command discrimination)", () => {
    vi.useFakeTimers();
    const { result, notify, resolve } = setup();

    act(() => result.current.actions.addNode()); // cmd-1: 応答が来ないまま放置
    act(() => result.current.actions.addWorkbench("Bob")); // cmd-2: 成功で解決
    expect(result.current.ghosts).toHaveLength(3); // node 2枚 + workbench 1枚

    resolve(1, true); // addWorkbench だけ成功（実体到着待ち）

    act(() => vi.advanceTimersByTime(GHOST_TIMEOUT_MS));

    // タイムアウト通知は未解決の addNode の分だけ（1件）。成功済みの
    // addWorkbench はタイムアウトしても通知しない。
    expect(result.current.ghosts).toHaveLength(0);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith({
      kind: "error",
      message: "Failed to add node: No response (timed out)",
    });
  });
});
