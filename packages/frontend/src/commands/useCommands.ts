import type { Command } from "@chainviz/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GHOST_TIMEOUT_MS,
  type GhostFlowNode,
  type GhostKind,
  createGhostNode,
  removeGhostByCommandId,
  removeOldestGhostByKind,
} from "../entities/ghostNode.js";
import type { OperationSignal } from "../entities/operationEdge.js";
import type { MessageKey } from "../i18n/messages.js";
import type { NotificationInput } from "../notifications/notificationStore.js";
import { type WorldState, emptyWorldState } from "../world-state/store.js";
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
  /** 揮発性の操作観測イベント列（描画側で操作パルスに消費する）。 */
  operations: OperationSignal[];
  actions: CommandActions;
  /**
   * addNode / addWorkbench 送信直後、実エンティティが届くまでの間だけ表示する
   * 仮カード（ゴーストノード）列（Issue #102）。描画側は infra/wallet の
   * ノード配列にそのまま連結してキャンバスへ渡す。
   */
  ghosts: GhostFlowNode[];
}

/**
 * ワールドステート購読（useWorldState）に、操作コマンドの発行・保留追跡・
 * 失敗時のトースト通知（#39）・仮カード（ゴーストノード）の表示（#102）を
 * 組み合わせたフック。
 *
 * 送ったコマンドは commandId をキーに pending へ記録し、collector から
 * commandResult(ok:false) が返ったら、どの操作が失敗したかを添えて notify する。
 * notify / t は毎レンダーで参照が変わりうるので ref 経由で最新を呼ぶ。
 *
 * addNode / addWorkbench は同時に「仮カード」を1枚生成する。実エンティティが
 * world-state の diff（entityAdded）として届いたら、同種のうち最も古い仮カードを
 * 1枚取り除く（commandId までは entity 側に伝わらないため、送信順に実体化する
 * という FIFO の近似で対応づける。詳細は entities/ghostNode.ts 参照）。
 * commandResult(ok:false) の場合は commandId で直接その仮カードを取り除く。
 * どちらも来ない異常系に備え、仮カードには安全網のタイムアウトも付ける。
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

  const [ghosts, setGhosts] = useState<GhostFlowNode[]>([]);
  // dispatch はコマンド発行のたびに再生成したくない（sendCommand のみに依存させる）
  // ため、ゴースト生成に使う「現在のワールドステート / ゴースト件数」は ref 経由で
  // 読む（notifyRef / tRef と同じ、レンダーのたびに最新値へ同期するパターン）。
  const stateRef = useRef<WorldState>(emptyWorldState);
  // ゴーストの並び位置に使う通し番号。ghosts state（React の再レンダーを経て
  // 反映される）を直接参照すると、同一イベントハンドラ内で addNode を連続で
  // 呼んだ場合に render が挟まらず同じ長さを読んでしまい、複数のゴーストが
  // 同じグリッド位置に重なってしまう。ref のインクリメントは呼び出し即座に
  // 反映されるため、連打・連続呼び出しでも重複しない。ゴーストが消えても
  // 巻き戻さない（位置がずれるだけで実害はなく、以後常に新しいセルへ置ける）。
  const ghostSeqRef = useRef(0);

  const handleCommandResult = useCallback<CommandResultHandler>(
    (commandId, ok, error) => {
      const command = pendingRef.current.get(commandId);
      pendingRef.current.delete(commandId);
      if (!ok) {
        // 失敗が確定した時点で、対応する仮カードはもう実体化しないので消す。
        setGhosts((current) => removeGhostByCommandId(current, commandId));
        notifyRef.current({
          kind: "error",
          message: describeCommandError(command, error, tRef.current),
        });
      }
    },
    [],
  );

  const { state, status, operations, sendCommand } = useWorldState(
    clientFactory,
    handleCommandResult,
  );
  stateRef.current = state;

  // node / workbench の実エンティティが新規に届いたら、同種の仮カードを
  // 最も古いものから1枚取り除く（entityAdded は commandId を持たないため厳密な
  // 対応付けはできない。FIFO 近似の理由は entities/ghostNode.ts 参照）。
  const seenEntityIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const previous = seenEntityIdsRef.current;
    const currentIds = Object.keys(state.entities);
    const arrivedKinds: GhostKind[] = [];
    for (const id of currentIds) {
      if (previous.has(id)) continue;
      const entity = state.entities[id];
      if (entity && (entity.kind === "node" || entity.kind === "workbench")) {
        arrivedKinds.push(entity.kind);
      }
    }
    seenEntityIdsRef.current = new Set(currentIds);
    if (arrivedKinds.length === 0) return;
    setGhosts((current) => {
      let next = current;
      for (const kind of arrivedKinds) next = removeOldestGhostByKind(next, kind);
      return next;
    });
  }, [state.entities]);

  // ゴーストごとの安全網タイマーを ghosts state に合わせて張り直す。存在しなく
  // なった（実体到着 / 失敗 / 既にタイムアウト済み）ゴーストのタイマーは消し、
  // 新しく増えたゴーストにだけタイマーを張る。除去理由を問わない単純な同期に
  // することで、ここではタイムアウト固有のロジックを持たずに済む。
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  useEffect(() => {
    const timers = timersRef.current;
    const currentIds = new Set(ghosts.map((ghost) => ghost.data.commandId));

    for (const [commandId, timer] of timers) {
      if (!currentIds.has(commandId)) {
        clearTimeout(timer);
        timers.delete(commandId);
      }
    }

    for (const ghost of ghosts) {
      if (timers.has(ghost.data.commandId)) continue;
      const { commandId } = ghost.data;
      const timer = setTimeout(() => {
        timers.delete(commandId);
        setGhosts((current) => removeGhostByCommandId(current, commandId));
      }, GHOST_TIMEOUT_MS);
      timers.set(commandId, timer);
    }
  }, [ghosts]);

  // アンマウント時に残っている安全網タイマーをまとめて破棄する。
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const dispatch = useCallback(
    (command: Command) => {
      const commandId = sendCommand(command);
      if (commandId === undefined) return;
      pendingRef.current.set(commandId, command);

      if (command.action !== "addNode" && command.action !== "addWorkbench") {
        return;
      }
      const kind: GhostKind = command.action === "addNode" ? "node" : "workbench";
      const label =
        command.action === "addNode" ? command.chainProfile : command.label;
      const infraCount = Object.values(stateRef.current.entities).filter(
        (entity) => entity.kind === "node" || entity.kind === "workbench",
      ).length;
      const ghost = createGhostNode({
        commandId,
        kind,
        label,
        index: infraCount + ghostSeqRef.current,
      });
      ghostSeqRef.current += 1;
      setGhosts((current) => [...current, ghost]);
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

  return { state, status, operations, actions, ghosts };
}
