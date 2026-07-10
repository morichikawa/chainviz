import type {
  Command,
  WorkbenchOperation,
  WorldStateEntity,
} from "@chainviz/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CONTRACT_GRID } from "../entities/contractNode.js";
import {
  resolveBootNodes,
  resolveRpcTargetNode,
} from "../entities/connectionTargets.js";
import {
  GHOST_TIMEOUT_MS,
  type GhostFlowNode,
  createGhostNode,
  removeGhostByCommandId,
  removeGhostForArrivedEntity,
} from "../entities/ghostNode.js";
import type { NodeLinkActivitySignal } from "../entities/internalLinkEdge.js";
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
  describeCommandNotConnectedError,
  describeCommandTimeoutError,
  resolveWorkbenchLabel,
} from "./commandMessages.js";

/** キャンバス UI から呼ぶ操作コマンドの発行アクション群。 */
export interface CommandActions {
  addNode: (chainProfile?: string) => void;
  addWorkbench: (label: string) => void;
  removeNode: (nodeId: string) => void;
  removeWorkbench: (workbenchId: string) => void;
  /**
   * ワークベンチカードの操作パネル（送金/デプロイ/コントラクト呼び出し。
   * ARCHITECTURE.md §6.5）から発行する定型操作コマンド。
   */
  runWorkbenchOperation: (
    workbenchId: string,
    operation: WorkbenchOperation,
  ) => void;
}

export interface UseCommandsResult {
  state: WorldState;
  status: ConnectionStatus;
  /** 最初のスナップショットを受信済みか（`useWorldState`参照）。 */
  hasReceivedSnapshot: boolean;
  /** 揮発性の操作観測イベント列（描画側で操作パルスに消費する）。 */
  operations: OperationSignal[];
  /**
   * 揮発性の内部リンク活動観測イベント列（D層。描画側で活動パルスに消費
   * する。`useWorldState.ts` の docstring参照。Issue #188）。
   */
  nodeLinkActivities: NodeLinkActivitySignal[];
  actions: CommandActions;
  /**
   * addNode / addWorkbench 送信直後、実エンティティが届くまでの間だけ表示する
   * 仮カード（ゴーストノード）列（Issue #102）。描画側は infra/wallet の
   * ノード配列にそのまま連結してキャンバスへ渡す。
   */
  ghosts: GhostFlowNode[];
  /**
   * runWorkbenchOperation を送信してから commandResult が返るまでの間、
   * そのワークベンチの id を含む集合（ARCHITECTURE.md §6.5「ワークベンチ
   * カードにスピナー＋『実行中…』を出す」）。同一ワークベンチから複数の
   * 操作を連続送信しても（二重送信防止ではないため許容される）、すべてが
   * 解決するまで id を保持する（内部的には操作数のカウントで管理し、0件に
   * なった時点で id を集合から外す）。
   */
  pendingOperationWorkbenchIds: Set<string>;
  /**
   * removeNode / removeWorkbench を送信してから commandResult が返るまでの
   * 間、その対象（node/workbench 共通の entity id）を含む集合(Issue #222)。
   * `pendingOperationWorkbenchIds` と同じ「id ごとのカウンタ→Set化」方式で、
   * 成否によらず commandResult 到着時に解除する。node/workbench は id空間を
   * 共有し1entity=1カードなので、種別を問わず単一の Set で表現する。
   */
  pendingRemovalIds: Set<string>;
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
  // ゴーストの並び位置に使う「次に払い出すインデックス」。ghosts state
  // （React の再レンダーを経て反映される）を直接参照すると、同一イベント
  // ハンドラ内で addNode を連続で呼んだ場合に render が挟まらず同じ長さを
  // 読んでしまい、複数のゴーストが同じグリッド位置に重なってしまう。ref の
  // インクリメントは呼び出し即座に反映されるため、連打・連続呼び出しでも
  // 重複しない。
  //
  // この ref は一度払い出した値より小さい値を二度と払い出さない、単調増加の
  // カウンタとして扱う（過去に発行済みの仮カードの位置を巻き戻して再利用
  // することはない）。dispatch 側では、現在の infraCount を「最低でもこの値
  // 以上のインデックスにする」という下限としてのみ使い、この ref 自体の値と
  // 単純に合算はしない。合算方式のままだと、addNode の合間に既存インフラが
  // 削除されて infraCount が下がった直後に発行したゴーストの計算結果が、
  // 既に表示中の別の仮カードのインデックスと一致してしまう不具合があった
  // （Issue #113: entityAdded で infraCount=1 → addNode（index=1+0=1）→
  // entityRemoved で infraCount=0 → addNode（index=0+1=1 で前段と衝突））。
  const ghostIndexRef = useRef(0);
  // デプロイの仮カード（kind: "contract"）専用の、上記と同じ狙いの単調増加
  // カウンタ。node/workbench とは別のグリッド（CONTRACT_GRID）に置くため、
  // 衝突判定の基準（既存コントラクト数）も別に持つ必要があり、ref を分ける。
  const contractGhostIndexRef = useRef(0);

  // runWorkbenchOperation の保留数をワークベンチ id ごとに数える
  // （UseCommandsResult.pendingOperationWorkbenchIds の docstring参照）。
  const [pendingOperationCounts, setPendingOperationCounts] = useState<
    Map<string, number>
  >(new Map());
  const pendingOperationWorkbenchIds = useMemo(
    () => new Set(pendingOperationCounts.keys()),
    [pendingOperationCounts],
  );

  // removeNode / removeWorkbench の保留数を対象 id ごとに数える
  // （UseCommandsResult.pendingRemovalIds の docstring参照。Issue #222）。
  const [pendingRemovalCounts, setPendingRemovalCounts] = useState<
    Map<string, number>
  >(new Map());
  const pendingRemovalIds = useMemo(
    () => new Set(pendingRemovalCounts.keys()),
    [pendingRemovalCounts],
  );

  const handleCommandResult = useCallback<CommandResultHandler>(
    (commandId, ok, error) => {
      const command = pendingRef.current.get(commandId);
      pendingRef.current.delete(commandId);

      // runWorkbenchOperation の保留カウントは成否によらずここで解除する
      // （ARCHITECTURE.md §6.5「commandResult で解除」。二重送信防止では
      // ないので、同じワークベンチの別操作がまだ保留中ならカウントを
      // 1つ減らすだけでスピナーは出したままにする）。
      if (command?.action === "runWorkbenchOperation") {
        const { workbenchId } = command;
        setPendingOperationCounts((prev) => {
          const current = prev.get(workbenchId) ?? 0;
          const next = new Map(prev);
          if (current <= 1) next.delete(workbenchId);
          else next.set(workbenchId, current - 1);
          return next;
        });
      }

      // removeNode / removeWorkbench も同じく成否によらず解除する（Issue
      // #222）。ok:true なら entityRemoved diff で当のカードごと消える
      // ため実害は無いが、ok:false（削除拒否等）の場合はカードが残ったまま
      // 保留フラグだけが残り続けないよう、ここで確実に外す。
      if (
        command?.action === "removeNode" ||
        command?.action === "removeWorkbench"
      ) {
        const targetId =
          command.action === "removeNode" ? command.nodeId : command.workbenchId;
        setPendingRemovalCounts((prev) => {
          const current = prev.get(targetId) ?? 0;
          const next = new Map(prev);
          if (current <= 1) next.delete(targetId);
          else next.set(targetId, current - 1);
          return next;
        });
      }

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

  const {
    state,
    status,
    hasReceivedSnapshot,
    operations,
    nodeLinkActivities,
    sendCommand,
  } = useWorldState(clientFactory, handleCommandResult);
  stateRef.current = state;

  // node / workbench / contract の実エンティティが新規に届いたら、対応する
  // 仮カードを1枚取り除く（entityAdded は commandId を持たないため厳密な
  // 対応付けはできない。node は到着した clientType から EL/CL の層を判定し、
  // 同じ層のゴーストを優先して消す（addNode が reth/beacon の2枚のゴーストを
  // 生むため）。contract は到着した catalogKey で対応するデプロイ中の仮カード
  // を優先して消す（ARCHITECTURE.md §6.5）。FIFO 近似・フォールバックの
  // 理由は entities/ghostNode.ts 参照。
  const seenEntityIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const previous = seenEntityIdsRef.current;
    const currentIds = Object.keys(state.entities);
    const arrivedEntities: WorldStateEntity[] = [];
    for (const id of currentIds) {
      if (previous.has(id)) continue;
      const entity = state.entities[id];
      if (
        entity &&
        (entity.kind === "node" ||
          entity.kind === "workbench" ||
          entity.kind === "contract")
      ) {
        arrivedEntities.push(entity);
      }
    }
    seenEntityIdsRef.current = new Set(currentIds);
    if (arrivedEntities.length === 0) return;
    setGhosts((current) => {
      let next = current;
      for (const entity of arrivedEntities) {
        next = removeGhostForArrivedEntity(
          next,
          entity.kind === "node"
            ? { kind: "node", clientType: entity.clientType }
            : entity.kind === "contract"
              ? { kind: "contract", catalogKey: entity.catalogKey }
              : { kind: "workbench" },
        );
      }
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
        // pendingRef にまだ command が残っている＝commandResult 自体が一度も
        // 届いていない（未接続で送信できなかった以外にも、途中で collector
        // が落ちた・メッセージが失われた等の異常系。Issue #235）ケースだけ、
        // 実質的な失敗確定としてエラートーストで知らせる。pendingRef はこの
        // 経路以外では commandResult 到着時にしか消えないため、ここで
        // 消しておかないと残り続けてしまう。
        //
        // 一方 commandResult(ok:true) が既に届いていて pendingRef からも
        // 消えている場合は、単に実エンティティの到着（diff）がまだ間に
        // 合っていないだけ（コンテナ起動が遅い等）で、コマンド自体は成功
        // している。この場合は `GHOST_TIMEOUT_MS` の本来の役割（ghostNode.ts
        // のコメント参照）どおり、通知はせず黙ってゴーストを消すだけに
        // とどめる（誤って「失敗した」と伝えてしまう false positive を防ぐ）。
        const command = pendingRef.current.get(commandId);
        const resultNeverArrived = pendingRef.current.has(commandId);
        pendingRef.current.delete(commandId);
        setGhosts((current) => removeGhostByCommandId(current, commandId));
        if (resultNeverArrived) {
          notifyRef.current({
            kind: "error",
            message: describeCommandTimeoutError(command, tRef.current),
          });
        }
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
      if (commandId === undefined) {
        // WebSocket 未接続でコマンドがそもそも送れなかった場合（Issue #235）。
        // ゴーストを作らず、待たせずに理由付きのエラートーストを出す。
        notifyRef.current({
          kind: "error",
          message: describeCommandNotConnectedError(command, tRef.current),
        });
        return;
      }
      pendingRef.current.set(commandId, command);

      if (command.action === "runWorkbenchOperation") {
        const { workbenchId } = command;
        setPendingOperationCounts((prev) => {
          const next = new Map(prev);
          next.set(workbenchId, (next.get(workbenchId) ?? 0) + 1);
          return next;
        });

        // デプロイのみコントラクト行へ仮カードを置く（ARCHITECTURE.md §6.5）。
        // 送金・呼び出しは既存エンティティへの副作用（残高/イベント）のみで、
        // 新規カードが生まれないため仮カードは作らない。
        if (command.operation.type === "deployContract") {
          const contractCount = Object.values(
            stateRef.current.entities,
          ).filter((entity) => entity.kind === "contract").length;
          const index = Math.max(contractGhostIndexRef.current, contractCount);
          contractGhostIndexRef.current = index + 1;
          const ghost = createGhostNode({
            commandId,
            kind: "contract",
            // カタログキー自体が人が読める表示名（例: "ChainvizToken"）を
            // 兼ねるため、ゴーストのラベルにもそのまま使う（i18n 不要）。
            label: command.operation.contractKey,
            catalogKey: command.operation.contractKey,
            index,
            grid: CONTRACT_GRID,
          });
          setGhosts((current) => [...current, ghost]);
        }
        return;
      }

      if (command.action === "removeNode" || command.action === "removeWorkbench") {
        const targetId =
          command.action === "removeNode" ? command.nodeId : command.workbenchId;
        setPendingRemovalCounts((prev) => {
          const next = new Map(prev);
          next.set(targetId, (next.get(targetId) ?? 0) + 1);
          return next;
        });
        return;
      }

      if (command.action !== "addNode" && command.action !== "addWorkbench") {
        return;
      }

      const infraCount = Object.values(stateRef.current.entities).filter(
        (entity) => entity.kind === "node" || entity.kind === "workbench",
      ).length;
      // 既存の node/workbench カードと衝突しないよう infraCount を下限にしつつ、
      // 一度払い出した値より下がらないよう ghostIndexRef 自身の値も下限にする。
      const nextIndex = () => {
        const index = Math.max(ghostIndexRef.current, infraCount);
        ghostIndexRef.current = index + 1;
        return index;
      };

      if (command.action === "addNode") {
        // フォロワー reth + beacon の2コンテナ追加を、2枚のゴースト（EL/CL）
        // で表す（Issue #123 UX設計 §4-2）。接続予定先（ブートノード）は
        // 現時点の world-state から解決できる範囲で予告し、解決できなければ
        // 省略する（§4-5 フォールバック。createGhostNode が undefined を
        // そのまま許容する）。
        const bootNodes = resolveBootNodes(
          Object.values(stateRef.current.entities),
        );
        const executionGhost = createGhostNode({
          commandId,
          kind: "node",
          label: command.chainProfile,
          index: nextIndex(),
          layer: "execution",
          targetContainerName: bootNodes.execution?.containerName,
          targetNodeId: bootNodes.execution?.id,
        });
        const consensusGhost = createGhostNode({
          commandId,
          kind: "node",
          label: command.chainProfile,
          index: nextIndex(),
          layer: "consensus",
          targetContainerName: bootNodes.consensus?.containerName,
          targetNodeId: bootNodes.consensus?.id,
        });
        setGhosts((current) => [...current, executionGhost, consensusGhost]);
        return;
      }

      // addWorkbench: 現行の RPC 接続先は固定なので、既存ワークベンチの
      // rpcTargetNodeId を「新しく追加するワークベンチも同じ対象に繋がる」
      // 近似値として使う（connectionTargets.ts 参照）。解決できなければ
      // 省略する（§4-5）。
      const rpcTarget = resolveRpcTargetNode(
        Object.values(stateRef.current.entities),
      );
      const ghost = createGhostNode({
        commandId,
        kind: "workbench",
        label: command.label,
        index: nextIndex(),
        targetContainerName: rpcTarget?.containerName,
        targetNodeId: rpcTarget?.id,
      });
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
      runWorkbenchOperation: (workbenchId: string, operation: WorkbenchOperation) =>
        dispatch({ action: "runWorkbenchOperation", workbenchId, operation }),
    }),
    [dispatch],
  );

  return {
    state,
    status,
    hasReceivedSnapshot,
    operations,
    nodeLinkActivities,
    actions,
    ghosts,
    pendingOperationWorkbenchIds,
    pendingRemovalIds,
  };
}
