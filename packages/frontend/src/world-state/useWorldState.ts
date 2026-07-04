import { useCallback, useEffect, useRef, useState } from "react";
import type { Command } from "@chainviz/shared";
import type {
  ChainvizClient,
  ChainvizClientHandlers,
  ConnectionStatus,
} from "../websocket/client.js";
import { type WorldState, applyDiff, applySnapshot, emptyWorldState } from "./store.js";

export type ClientFactory = (handlers: ChainvizClientHandlers) => ChainvizClient;

/** コマンド結果（commandResult）を受け取るハンドラ。 */
export type CommandResultHandler = (
  commandId: string,
  ok: boolean,
  error?: string,
) => void;

export interface UseWorldStateResult {
  state: WorldState;
  status: ConnectionStatus;
  /** 操作コマンドを送り、生成された commandId を返す（未接続なら undefined）。 */
  sendCommand: (command: Command) => string | undefined;
}

/**
 * collector クライアント（実 WebSocket または mock）を接続し、届いた
 * snapshot / diff をワールドステートへ畳み込む React フック。
 * `createClient` は呼び出し側で安定した参照にすること（useCallback など）。
 *
 * `onCommandResult` は毎レンダーで参照が変わってもクライアントを張り直さない
 * よう ref 経由で最新のものを呼ぶ。`sendCommand` は接続中のクライアントへ
 * コマンドを委譲する安定した関数を返す。
 */
export function useWorldState(
  createClient: ClientFactory,
  onCommandResult?: CommandResultHandler,
): UseWorldStateResult {
  const [state, setState] = useState<WorldState>(emptyWorldState);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const clientRef = useRef<ChainvizClient | null>(null);
  const resultRef = useRef<CommandResultHandler | undefined>(onCommandResult);
  resultRef.current = onCommandResult;

  useEffect(() => {
    const client = createClient({
      onSnapshot: (snapshot) => setState(applySnapshot(snapshot)),
      onDiff: (events) => setState((current) => applyDiff(current, events)),
      onStatusChange: setStatus,
      onCommandResult: (commandId, ok, error) =>
        resultRef.current?.(commandId, ok, error),
    });
    clientRef.current = client;
    client.connect();
    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [createClient]);

  const sendCommand = useCallback(
    (command: Command) => clientRef.current?.sendCommand(command),
    [],
  );

  return { state, status, sendCommand };
}
