import type { Command } from "@chainviz/shared";
import { useCallback, useMemo, useRef } from "react";
import type { MessageKey } from "../i18n/messages.js";
import type { NotificationInput } from "../notifications/notificationStore.js";
import type { WorldState } from "../world-state/store.js";
import {
  type ClientFactory,
  type CommandResultHandler,
  useWorldState,
} from "../world-state/useWorldState.js";
import type { ConnectionStatus } from "../websocket/client.js";
import {
  DEFAULT_CHAIN_PROFILE,
  describeCommandError,
  resolveWorkbenchLabel,
} from "./commandMessages.js";

/** キャンバス UI から呼ぶ操作コマンドの発行アクション群。 */
export interface CommandActions {
  addNode: (chainProfile?: string) => void;
  addWorkbench: (label: string) => void;
  removeNode: (nodeId: string) => void;
  removeWorkbench: (workbenchId: string) => void;
}

export interface UseCommandsResult {
  state: WorldState;
  status: ConnectionStatus;
  actions: CommandActions;
}

/**
 * ワールドステート購読（useWorldState）に、操作コマンドの発行・保留追跡・
 * 失敗時のトースト通知（#39）を組み合わせたフック。
 *
 * 送ったコマンドは commandId をキーに pending へ記録し、collector から
 * commandResult(ok:false) が返ったら、どの操作が失敗したかを添えて notify する。
 * notify / t は毎レンダーで参照が変わりうるので ref 経由で最新を呼ぶ。
 */
export function useCommands(
  clientFactory: ClientFactory,
  notify: (input: NotificationInput) => string,
  t: (key: MessageKey) => string,
): UseCommandsResult {
  const pendingRef = useRef<Map<string, Command>>(new Map());
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const tRef = useRef(t);
  tRef.current = t;

  const handleCommandResult = useCallback<CommandResultHandler>(
    (commandId, ok, error) => {
      const command = pendingRef.current.get(commandId);
      pendingRef.current.delete(commandId);
      if (!ok) {
        notifyRef.current({
          kind: "error",
          message: describeCommandError(command, error, tRef.current),
        });
      }
    },
    [],
  );

  const { state, status, sendCommand } = useWorldState(
    clientFactory,
    handleCommandResult,
  );

  const dispatch = useCallback(
    (command: Command) => {
      const commandId = sendCommand(command);
      if (commandId !== undefined) pendingRef.current.set(commandId, command);
    },
    [sendCommand],
  );

  const actions = useMemo<CommandActions>(
    () => ({
      addNode: (chainProfile = DEFAULT_CHAIN_PROFILE) =>
        dispatch({ action: "addNode", chainProfile }),
      addWorkbench: (label: string) =>
        dispatch({ action: "addWorkbench", label: resolveWorkbenchLabel(label) }),
      removeNode: (nodeId: string) =>
        dispatch({ action: "removeNode", nodeId }),
      removeWorkbench: (workbenchId: string) =>
        dispatch({ action: "removeWorkbench", workbenchId }),
    }),
    [dispatch],
  );

  return { state, status, actions };
}
