import { useCallback, useEffect, useRef, useState } from "react";
import type { Command, DiffEvent } from "@chainviz/shared";
import type { NodeLinkActivitySignal } from "../entities/internalLinkEdge.js";
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
  extractNodeLinkActivities,
  extractOperations,
} from "./store.js";

export type ClientFactory = (handlers: ChainvizClientHandlers) => ChainvizClient;

/** コマンド結果（commandResult）を受け取るハンドラ。 */
export type CommandResultHandler = (
  commandId: string,
  ok: boolean,
  error?: string,
) => void;

/**
 * 差分イベント到着を「適用前の WorldState」付きで観測するコールバック
 * （Issue #317。`useCommsLog` の `deriveCommsLogEntries` へ渡す入力を
 * 作るためのもの）。呼ばれる時点ではまだ `state` は更新されていない
 * （`prevState` = このイベント列を適用する前の世界）。`now` は onDiff を
 * 受け取った時点のフロント側時刻（epoch ms）で、イベント自身が時刻を
 * 持たない場合のフォールバックに使う想定。
 *
 * スナップショット適用（初回・再接続）では呼ばれない（diff由来のみ。
 * 設計メモ §7.1）。
 */
export type DiffObserver = (
  prevState: WorldState,
  events: DiffEvent[],
  now: number,
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
  /**
   * 揮発性の内部リンク活動観測イベント（D層。`NodeEntity.drivesNodeId` 上の
   * Engine API 呼び出し。ARCHITECTURE.md §7.6.4）の直近列。`operations` と
   * 同じ経路分離の理由で、ワールドステートには畳み込まず、描画側
   * （`useNodeLinkActivityPulses`）が seq をキーに未処理分を消費して活動
   * パルスを走らせる。
   */
  nodeLinkActivities: NodeLinkActivitySignal[];
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

/** `nodeLinkActivities` の最大保持数。`OPERATION_SIGNAL_CAP` と同じ理由。 */
const NODE_LINK_ACTIVITY_SIGNAL_CAP = 100;

/**
 * collector クライアント（実 WebSocket または mock）を接続し、届いた
 * snapshot / diff をワールドステートへ畳み込む React フック。
 * `createClient` は呼び出し側で安定した参照にすること（useCallback など）。
 *
 * `onCommandResult` は毎レンダーで参照が変わってもクライアントを張り直さない
 * よう ref 経由で最新のものを呼ぶ。`sendCommand` は接続中のクライアントへ
 * コマンドを委譲する安定した関数を返す。
 *
 * `onDiffEvents` も同じく ref 経由で最新のものを呼ぶ（Issue #317）。
 * `state` の更新自体は、React 18 Strict Mode が `setState` へ渡した
 * 更新関数を開発時に二重実行しうる（副作用の検出目的）ことを踏まえ、
 * 更新関数の中では副作用（`onDiffEvents` の呼び出し）を起こさない設計に
 * している。代わりに `worldStateRef` で「適用前の WorldState」を手動で
 * 同期させ、その値を使って新しい state を関数の外で計算してから
 * `setState` へ確定値として渡す（`setState(fn)` ではなく `setState(value)`）。
 * これにより `onDiffEvents` は onDiff 呼び出しごとに厳密に1回だけ実行される。
 */
export function useWorldState(
  createClient: ClientFactory,
  onCommandResult?: CommandResultHandler,
  onDiffEvents?: DiffObserver,
): UseWorldStateResult {
  const [state, setState] = useState<WorldState>(emptyWorldState);
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [hasReceivedSnapshot, setHasReceivedSnapshot] = useState(false);
  const [operations, setOperations] = useState<OperationSignal[]>([]);
  const [nodeLinkActivities, setNodeLinkActivities] = useState<
    NodeLinkActivitySignal[]
  >([]);
  const clientRef = useRef<ChainvizClient | null>(null);
  const resultRef = useRef<CommandResultHandler | undefined>(onCommandResult);
  resultRef.current = onCommandResult;
  const diffObserverRef = useRef<DiffObserver | undefined>(onDiffEvents);
  diffObserverRef.current = onDiffEvents;
  // 操作観測イベントにフロント側で振る通し番号。単調増加させ、消費側の重複排除に使う。
  const opSeqRef = useRef(0);
  // 内部リンク活動観測イベントにフロント側で振る通し番号（opSeqRef と同じ狙い）。
  const nodeLinkActivitySeqRef = useRef(0);
  // 直近確定した WorldState（onDiffEvents に渡す「適用前」を得るための影武者。
  // 上記docstring参照）。setState と手動で同期させる。
  const worldStateRef = useRef<WorldState>(emptyWorldState);

  useEffect(() => {
    const client = createClient({
      onSnapshot: (snapshot) => {
        const next = applySnapshot(snapshot);
        worldStateRef.current = next;
        setState(next);
        setHasReceivedSnapshot(true);
      },
      onDiff: (events) => {
        const prevState = worldStateRef.current;
        const nextState = applyDiff(prevState, events);
        worldStateRef.current = nextState;
        setState(nextState);
        diffObserverRef.current?.(prevState, events, Date.now());
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
        // nodeLinkActivity も同じく揮発性なのでワールドステートへ畳み込まず、
        // 通し番号を付けた別経路（nodeLinkActivities）へ流す。
        const linkActivities = extractNodeLinkActivities(events);
        if (linkActivities.length > 0) {
          setNodeLinkActivities((current) => {
            const appended = current.slice();
            for (const activity of linkActivities) {
              appended.push({ seq: nodeLinkActivitySeqRef.current++, activity });
            }
            return appended.length > NODE_LINK_ACTIVITY_SIGNAL_CAP
              ? appended.slice(appended.length - NODE_LINK_ACTIVITY_SIGNAL_CAP)
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

  return {
    state,
    status,
    hasReceivedSnapshot,
    operations,
    nodeLinkActivities,
    sendCommand,
  };
}
