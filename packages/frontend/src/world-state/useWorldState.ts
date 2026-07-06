import { useCallback, useEffect, useRef, useState } from "react";
import type { Command } from "@chainviz/shared";
import type { OperationSignal } from "../entities/operationEdge.js";
import type {
  ChainvizClient,
  ChainvizClientHandlers,
  ConnectionStatus,
} from "../websocket/client.js";
import {
  type WorldState,
  applyDiff,
  applySnapshot,
  emptyWorldState,
  extractOperations,
} from "./store.js";

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
  /**
   * 最初のスナップショットを受信済みか。`status === "connected"` は
   * WebSocketの接続確立（onopen相当）で立つ一方、スナップショットは
   * その後の別メッセージで届くため、実クライアントでは両者の間に
   * 「connected だが entities は空」というレンダーが必ず1回挟まる
   * （モッククライアントは接続とスナップショット配信が同期的なため
   * この間隙が無く、テストで見落としやすい）。「基準となる初期集合が
   * まだ確立していない空」と「接続済みで本当に0件」を区別する必要が
   * ある呼び出し側（useNewArrivalHighlightのready等）は、
   * `status === "connected"` ではなくこちらを使うこと。
   */
  hasReceivedSnapshot: boolean;
  /**
   * 揮発性の操作観測イベント（ワークベンチ → ノードの RPC 呼び出し）の直近列。
   * ワールドステートには畳み込まず、描画側（useOperationPulses）が seq をキーに
   * 未処理分を消費してパルスアニメーションを走らせる。
   */
  operations: OperationSignal[];
  /** 操作コマンドを送り、生成された commandId を返す（未接続なら undefined）。 */
  sendCommand: (command: Command) => string | undefined;
}

/**
 * 保持しておく操作観測イベントの最大数。届いたイベントは同じレンダーサイクル内で
 * useOperationPulses が seq をキーに即消費するため、これは「消費前に破棄しない」
 * ための余裕を持ったメモリ上限であり、観測できる件数に依存した閾値ではない。
 * WebSocket メッセージ 1 通ごとに onDiff → 再レンダー → 消費が走るので、この上限を
 * 超える未消費イベントが積み上がることはない。
 */
const OPERATION_SIGNAL_CAP = 100;

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
  const [hasReceivedSnapshot, setHasReceivedSnapshot] = useState(false);
  const [operations, setOperations] = useState<OperationSignal[]>([]);
  const clientRef = useRef<ChainvizClient | null>(null);
  const resultRef = useRef<CommandResultHandler | undefined>(onCommandResult);
  resultRef.current = onCommandResult;
  // 操作観測イベントにフロント側で振る通し番号。単調増加させ、消費側の重複排除に使う。
  const opSeqRef = useRef(0);

  useEffect(() => {
    const client = createClient({
      onSnapshot: (snapshot) => {
        setState(applySnapshot(snapshot));
        setHasReceivedSnapshot(true);
      },
      onDiff: (events) => {
        setState((current) => applyDiff(current, events));
        // operationObserved は揮発性なのでワールドステートへ畳み込まず、
        // 通し番号を付けた別経路（operations）へ流す。
        const observed = extractOperations(events);
        if (observed.length > 0) {
          setOperations((current) => {
            const appended = current.slice();
            for (const edge of observed) {
              appended.push({ seq: opSeqRef.current++, edge });
            }
            return appended.length > OPERATION_SIGNAL_CAP
              ? appended.slice(appended.length - OPERATION_SIGNAL_CAP)
              : appended;
          });
        }
      },
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

  return { state, status, hasReceivedSnapshot, operations, sendCommand };
}
