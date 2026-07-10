import type {
  BlockEntity,
  ContractEntity,
  NodeEntity,
  TransactionEntity,
  WalletEntity,
  WorkbenchEntity,
} from "@chainviz/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas } from "../canvas/Canvas.js";
import { CanvasToolbar } from "../canvas/CanvasToolbar.js";
import { CommandActionsProvider } from "../commands/CommandActionsContext.js";
import { useCommands } from "../commands/useCommands.js";
import { ToastStack } from "../notifications/Toast.js";
import { useNotifications } from "../notifications/useNotifications.js";
import { attachPulsesToEdges } from "../entities/blockPulse.js";
import { resolveBootNodes } from "../entities/connectionTargets.js";
import { connectingEdgesToFlowEdges } from "../entities/connectingEdge.js";
import {
  CONTRACT_GRID,
  type ContractFlowNode,
  contractsToFlowNodes,
  isContractEntity,
  isSameContractNode,
} from "../entities/contractNode.js";
import { deployEdgesToFlowEdges } from "../entities/deployEdge.js";
import {
  type InfraFlowNode,
  entitiesToFlowNodes,
  isInfraEntity,
  isSameInfraNode,
  resolveLayoutPositions,
} from "../entities/infraNode.js";
import { internalLinkEdgesToFlowEdges } from "../entities/internalLinkEdge.js";
import { peerEdgesToFlowEdges } from "../entities/peerEdge.js";
import { ownershipEdgesToFlowEdges } from "../entities/ownershipEdge.js";
import { operationTargetEdgesToFlowEdges } from "../entities/operationTargetEdge.js";
import { ghostsToPendingConnectionEdges } from "../entities/pendingConnectionEdge.js";
import { stabilizeArrayReference, stabilizeNodes } from "../entities/nodeStability.js";
import { indexTransactions } from "../entities/transaction.js";
import { useBlockPulses } from "../entities/useBlockPulses.js";
import { useContractSettlementEffects } from "../entities/useContractSettlementEffects.js";
import { useNewArrivalHighlight } from "../entities/useNewArrivalHighlight.js";
import { useNodeLinkActivityPulses } from "../entities/useNodeLinkActivityPulses.js";
import { useOperationPulses } from "../entities/useOperationPulses.js";
import { useTxLifecycle } from "../entities/useTxLifecycle.js";
import {
  type WalletFlowNode,
  isSameWalletNode,
  walletsToFlowNodes,
} from "../entities/walletNode.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { glossary as defaultGlossary } from "../glossary/data.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider, useLanguage } from "../i18n/LanguageProvider.js";
import { LanguageToggle } from "../i18n/LanguageToggle.js";
import type { MessageKey } from "../i18n/messages.js";
import {
  type LayoutMap,
  type Position,
  loadLayout,
  saveLayout,
  saveNodePosition,
} from "../layout/layoutStore.js";
import { ETHEREUM_OPERATION_CATALOG } from "../chain-profiles/ethereum/operationCatalog.js";
import { deriveDeployedContracts } from "../operations/deployedContracts.js";
import { OperationDataProvider } from "../operations/OperationDataContext.js";
import { deriveWalletCandidates } from "../operations/walletCandidates.js";
import { type KeyValueStorage, getBrowserStorage } from "../platform/storage.js";
import type { ConnectionStatus } from "../websocket/client.js";
import { createMockClient } from "../websocket/mockData.js";
import { listEdges, listEntities } from "../world-state/store.js";
import type { ClientFactory } from "../world-state/useWorldState.js";

export interface AppProps {
  /** collector クライアント生成関数。既定はモック。 */
  clientFactory?: ClientFactory;
  /** モック接続かどうか（ヘッダ表示用）。 */
  isMock?: boolean;
  /** 用語データ。既定は実データ。 */
  glossary?: Glossary;
  /** レイアウト永続化ストレージ。既定はブラウザ localStorage。 */
  storage?: KeyValueStorage;
}

const STATUS_KEY: Record<ConnectionStatus, MessageKey> = {
  connecting: "connection.connecting",
  connected: "connection.connected",
  disconnected: "connection.disconnected",
};

function StatusBadge({
  status,
  isMock,
}: {
  status: ConnectionStatus;
  isMock: boolean;
}) {
  const { t } = useLanguage();
  return (
    <span
      className={`status-badge status-badge--${status}`}
      data-testid="connection-status-badge"
    >
      {t(STATUS_KEY[status])}
      {isMock ? ` · ${t("connection.mock")}` : ""}
    </span>
  );
}

function AppShell({
  clientFactory,
  isMock,
  storage,
}: {
  clientFactory: ClientFactory;
  isMock: boolean;
  storage: KeyValueStorage;
}) {
  const { t } = useLanguage();
  const [layout, setLayout] = useState<LayoutMap>(() => loadLayout(storage));
  const { notifications, notify, dismiss } = useNotifications();

  const {
    state,
    status,
    hasReceivedSnapshot,
    operations,
    nodeLinkActivities,
    actions,
    ghosts,
    pendingOperationWorkbenchIds,
  } = useCommands(clientFactory, notify, t);

  // ボタン押下直後のローディング表示（Issue #102）に使う。仮カードが
  // 1枚でも残っている間は「まだ実体化していない addNode/addWorkbench がある」
  // とみなす。
  const pendingAddNode = useMemo(
    () => ghosts.some((ghost) => ghost.data.kind === "node"),
    [ghosts],
  );
  const pendingAddWorkbench = useMemo(
    () => ghosts.some((ghost) => ghost.data.kind === "workbench"),
    [ghosts],
  );

  const entities = useMemo(() => listEntities(state), [state]);

  // 定型操作パネル（ARCHITECTURE.md §6.5）が必要とする、キャンバス上の
  // 「今」の候補一覧。React Flow ノードの data には含めない
  // （operations/OperationDataContext.ts の docstring参照）。
  const walletCandidates = useMemo(
    () => deriveWalletCandidates(entities),
    [entities],
  );
  const deployedContracts = useMemo(
    () => deriveDeployedContracts(entities, ETHEREUM_OPERATION_CATALOG),
    [entities],
  );

  // 新規に現れた node/workbench には、まだ保存済みレイアウトが無い位置へ
  // その場で空きグリッドスロットを確定し、layoutStore（localStorage）へ
  // 即座に保存する（Issue #123 UX設計 §4-3 ルール1）。以後は保存済み
  // レイアウト扱いになるため、他のカードの増減で二度と動かない
  // （entitiesToFlowNodes の「毎回 id ソートで添字を振り直す」旧方式を廃止）。
  useEffect(() => {
    const containerNames = entities
      .filter(isInfraEntity)
      .map((entity) => entity.containerName);
    const next = resolveLayoutPositions(containerNames, layout);
    if (next === layout) return; // 追加すべき新規カードが無ければ何もしない
    saveLayout(storage, next);
    setLayout(next);
  }, [entities, layout, storage]);

  // コントラクト行も同じ「初出時に空きスロットを確定して即保存」ルールに
  // 従う（ARCHITECTURE.md §6.2。ウォレット行とは異なりコントラクトは
  // インフラと同じ確定配置にする決定）。安定 ID は address、グリッドは
  // 専用の CONTRACT_GRID を使う。
  useEffect(() => {
    const addresses = entities
      .filter(isContractEntity)
      .map((entity) => entity.address);
    const next = resolveLayoutPositions(addresses, layout, CONTRACT_GRID);
    if (next === layout) return;
    saveLayout(storage, next);
    setLayout(next);
  }, [entities, layout, storage]);

  // 実カード到着からの新着強調（Issue #123 UX設計 §4-4）。コントラクト行にも
  // 同じ発光を当てる（ARCHITECTURE.md §6.2）ため、対象 id にコントラクトの
  // address も含める。
  const infraEntityIds = useMemo(
    () => entities.filter(isInfraEntity).map((entity) => entity.id),
    [entities],
  );
  const contractEntityIds = useMemo(
    () => entities.filter(isContractEntity).map((entity) => entity.address),
    [entities],
  );
  const newArrivalIds = useMemo(
    () => [...infraEntityIds, ...contractEntityIds],
    [infraEntityIds, contractEntityIds],
  );
  // 最初のスナップショット到着前は判定・基準確立とも行わない
  // （useNewArrivalHighlight のdocstring参照。`status === "connected"`は
  // WebSocketの接続確立時点であり、その後に届くスナップショットとは
  // タイミングがずれるため使わない。実クライアントでは両者の間に
  // 「connectedだがentitiesは空」のレンダーが挟まり得る）。
  const newArrivals = useNewArrivalHighlight(newArrivalIds, hasReceivedSnapshot);

  // ノードカードのちらつき対策(Issue #119)。本質的な対策は Canvas.tsx の
  // preserveMeasuredDimensions(React Flow が実測した measured を引き継ぐ)
  // 側にある。ここではそれを補完し、ワールドステート更新のたびに
  // entitiesToFlowNodes / walletsToFlowNodes が全ノードを新しいオブジェクトと
  // して作り直してしまう無駄を減らすため、前回の出力を ref に保持し、内容が
  // 変わっていないノードは同一オブジェクト参照を再利用する(該当ノードの
  // React 側の再レンダー自体を避けられる)。
  const previousInfraNodesRef = useRef<InfraFlowNode[]>([]);
  const infraNodes = useMemo(() => {
    const next = stabilizeNodes(
      entitiesToFlowNodes(entities, layout),
      previousInfraNodesRef.current,
      isSameInfraNode,
    );
    previousInfraNodesRef.current = next;
    return next;
  }, [entities, layout]);

  // 新着強調フラグ（isNew）・操作パネルの保留フラグ（operationPending）は
  // どちらも「時間経過/保留状態」に依存し isSameInfraNode の比較対象ではない
  // ため、stabilizeNodes の後段で後付けする（entities/infraNode.ts の
  // InfraNodeData docstring参照）。実際にどちらかが変化したノードだけ新しい
  // オブジェクトにする（変化の無いノードの参照は保つ。Issue #119対策の効果を
  // 損なわないため）。
  const infraNodesWithHighlight = useMemo(
    () =>
      infraNodes.map((node) => {
        const isNew = newArrivals.has(node.id);
        const operationPending = pendingOperationWorkbenchIds.has(node.id);
        if (
          isNew === (node.data.isNew ?? false) &&
          operationPending === (node.data.operationPending ?? false)
        ) {
          return node;
        }
        return { ...node, data: { ...node.data, isNew, operationPending } };
      }),
    [infraNodes, newArrivals, pendingOperationWorkbenchIds],
  );

  // 現存するインフラノードの id 集合（ピア接続・所有エッジの端点存在判定に使う）。
  const infraNodeIds = useMemo(
    () => new Set(infraNodes.map((n) => n.id)),
    [infraNodes],
  );

  // B層のピア接続。端点が両方カードとして存在する紐だけを描く。
  const peerEdges = useMemo(
    () => peerEdgesToFlowEdges(listEdges(state), infraNodeIds),
    [state, infraNodeIds],
  );

  // ブロックの受信時刻差から伝播パルスを算出し、エッジ上へ走らせる。
  const blocks = useMemo(
    () =>
      entities.filter(
        (entity): entity is BlockEntity => entity.kind === "block",
      ),
    [entities],
  );
  const activePulses = useBlockPulses(blocks, peerEdges);
  const peerEdgesWithPulses = useMemo(
    () => attachPulsesToEdges(peerEdges, activePulses),
    [peerEdges, activePulses],
  );
  // tx の blockHash から BlockEntity.number を引く索引（コントラクトの
  // 「直近の呼び出し・イベント」チップの並び順に使う。ARCHITECTURE.md §6.6。
  // contractActivity.ts の docstring 参照）。
  const blockNumberByHash = useMemo(() => {
    const map = new Map<string, number>();
    for (const block of blocks) map.set(block.hash, block.number);
    return map;
  }, [blocks]);

  // C層拡張: コントラクト（ARCHITECTURE.md §6.2〜§6.4）。ウォレットの
  // WalletPopover が「呼び出し内容」の宛先コントラクト名解決に使う
  // （§6.6）ため、ウォレット関連の memo より先に算出する。
  //
  // infraNodes/walletNodes/contractNodes と同じ理由(Issue #119)で参照を
  // 安定化する（Issue #166 差し戻し対応）。`entities` は state 更新のたびに
  // 新しい配列になるため、素の filter だけだと中身が同じでも `contracts` が
  // 毎回新しい配列になり、それに依存する `contractsByAddress` の Map まで
  // 毎回作り直されてしまう。walletNode.ts の isSameWalletNode は
  // `contractsByAddress` を参照比較するため、Map の参照が安定しないと
  // 無関係な更新のたびに「変化した」と誤判定し、ウォレットカードの不要な
  // 再レンダー防止（Issue #119）が効かなくなる。
  const previousContractsRef = useRef<ContractEntity[]>([]);
  const contracts = useMemo(() => {
    const next = stabilizeArrayReference(
      entities.filter(isContractEntity),
      previousContractsRef.current,
    );
    previousContractsRef.current = next;
    return next;
  }, [entities]);
  const contractsByAddress = useMemo(
    () => new Map(contracts.map((c) => [c.address, c])),
    [contracts],
  );

  // C層: ウォレット・トランザクション。
  const wallets = useMemo(
    () =>
      entities.filter(
        (entity): entity is WalletEntity => entity.kind === "wallet",
      ),
    [entities],
  );
  const transactions = useMemo(
    () =>
      entities.filter(
        (entity): entity is TransactionEntity => entity.kind === "transaction",
      ),
    [entities],
  );
  const txByHash = useMemo(
    () => indexTransactions(transactions),
    [transactions],
  );
  // tx が pending → 確定へ変わった瞬間を検知し、確定フラッシュ演出中の集合を得る。
  const settling = useTxLifecycle(transactions);

  // infraNodes と同じ理由(Issue #119)でウォレットカードも参照を安定化する。
  const previousWalletNodesRef = useRef<WalletFlowNode[]>([]);
  const walletNodes = useMemo(() => {
    const next = stabilizeNodes(
      walletsToFlowNodes(wallets, {
        layout,
        txByHash,
        settling,
        presentInfraIds: infraNodeIds,
        contractsByAddress,
      }),
      previousWalletNodesRef.current,
      isSameWalletNode,
    );
    previousWalletNodesRef.current = next;
    return next;
  }, [wallets, layout, txByHash, settling, infraNodeIds, contractsByAddress]);

  // ワークベンチ → ウォレットの所有エッジ（点線・別色で B層のピア接続と区別）。
  const ownershipEdges = useMemo(
    () => ownershipEdgesToFlowEdges(wallets, infraNodeIds),
    [wallets, infraNodeIds],
  );

  // infraNodes/walletNodes と同じ理由(Issue #119)でコントラクトカードも
  // 参照を安定化する（`contracts` 自体はウォレット関連 memo より前で
  // 算出済み。§6.6 WalletPopover の宛先コントラクト名解決に使うため）。
  const previousContractNodesRef = useRef<ContractFlowNode[]>([]);
  const contractNodes = useMemo(() => {
    const next = stabilizeNodes(
      contractsToFlowNodes(contracts, { layout, transactions, blockNumberByHash }),
      previousContractNodesRef.current,
      isSameContractNode,
    );
    previousContractNodesRef.current = next;
    return next;
  }, [contracts, layout, transactions, blockNumberByHash]);

  // 現在キャンバスに存在するウォレットの address 集合（デプロイエッジの
  // 端点存在判定に使う。ownershipEdges の infraNodeIds と同じ狙い）。
  const walletAddressIds = useMemo(
    () => new Set(walletNodes.map((n) => n.id)),
    [walletNodes],
  );
  // ウォレット → コントラクトのデプロイエッジ（常設。ARCHITECTURE.md §6.3）。
  const deployEdges = useMemo(
    () => deployEdgesToFlowEdges(contracts, walletAddressIds),
    [contracts, walletAddressIds],
  );

  // tx確定時のコントラクトへの揮発パルス + 確定フラッシュ（ARCHITECTURE.md
  // §6.6「確定時のコントラクトへのパルス」。Issue #166）。
  const { pulseEdges: contractCallPulseEdges, flashing: contractFlashing } =
    useContractSettlementEffects(transactions, contracts, walletAddressIds);

  // 新着強調フラグ・確定フラッシュ種別の後付け（infraNodesWithHighlight と
  // 同じ狙い。どちらも時間経過に依存する派生状態で isSameContractNode の
  // 比較対象ではないため、stabilizeNodes の後段でここに付ける）。
  const contractNodesWithHighlight = useMemo(
    () =>
      contractNodes.map((node) => {
        const isNew = newArrivals.has(node.id);
        const flashKind = contractFlashing.get(node.id);
        if (
          isNew === (node.data.isNew ?? false) &&
          flashKind === node.data.flashKind
        ) {
          return node;
        }
        return { ...node, data: { ...node.data, isNew, flashKind } };
      }),
    [contractNodes, newArrivals, contractFlashing],
  );

  // ワークベンチ → ノードの操作（RPC 呼び出し）を、観測された瞬間だけ一時的な
  // エッジ + パルスとして描く（走り終わると消える揮発性のエッジ）。
  const operationEdges = useOperationPulses(operations, infraNodeIds);

  // Issue #123 UX設計 §4-2/§4-4: 追加操作の接続先予告・確立中表示・常設の
  // 操作先表示。ブートノードの解決（EL/CL）は複数箇所で使うので一度だけ算出する。
  const bootNodes = useMemo(() => resolveBootNodes(entities), [entities]);
  const nodeEntities = useMemo(
    () => entities.filter((entity): entity is NodeEntity => entity.kind === "node"),
    [entities],
  );
  const workbenchEntities = useMemo(
    () =>
      entities.filter(
        (entity): entity is WorkbenchEntity => entity.kind === "workbench",
      ),
    [entities],
  );
  // ゴースト（仮カード）→ 接続予定先ノードの点線エッジ（§4-2）。
  const pendingConnectionEdges = useMemo(
    () => ghostsToPendingConnectionEdges(ghosts, infraNodeIds),
    [ghosts, infraNodeIds],
  );
  // 実カード到着後、実 PeerEdge が1本も届いていない間の「接続確立中」エッジ（§4-4）。
  const connectingEdges = useMemo(
    () => connectingEdgesToFlowEdges(nodeEntities, listEdges(state), bootNodes, infraNodeIds),
    [nodeEntities, state, bootNodes, infraNodeIds],
  );
  // ワークベンチ → RPC 接続先ノードの常設「操作先」エッジ（§4-4）。
  // Issue #215: ホバーポップオーバー用に対象ノードの containerName 解決が
  // 要るため nodeEntities も渡す。
  const operationTargetEdges = useMemo(
    () => operationTargetEdgesToFlowEdges(workbenchEntities, nodeEntities, infraNodeIds),
    [workbenchEntities, nodeEntities, infraNodeIds],
  );

  // D層: 内部リンクエッジ（beacon(CL) → reth(EL)、常設。ARCHITECTURE.md
  // §7.6.3）の土台。`nodeLinkActivity` の活動パルス・直近観測は
  // `useNodeLinkActivityPulses` がこの土台へ合成する（Issue #188）。
  const internalLinkBaseEdges = useMemo(
    () => internalLinkEdgesToFlowEdges(nodeEntities, infraNodeIds),
    [nodeEntities, infraNodeIds],
  );
  const internalLinkEdges = useNodeLinkActivityPulses(
    nodeLinkActivities,
    internalLinkBaseEdges,
  );

  const nodes = useMemo(
    () => [
      ...infraNodesWithHighlight,
      ...walletNodes,
      ...contractNodesWithHighlight,
      ...ghosts,
    ],
    [infraNodesWithHighlight, walletNodes, contractNodesWithHighlight, ghosts],
  );
  const edges = useMemo(
    () => [
      ...peerEdgesWithPulses,
      ...ownershipEdges,
      ...deployEdges,
      ...operationEdges,
      ...pendingConnectionEdges,
      ...connectingEdges,
      ...operationTargetEdges,
      ...contractCallPulseEdges,
      ...internalLinkEdges,
    ],
    [
      peerEdgesWithPulses,
      ownershipEdges,
      deployEdges,
      operationEdges,
      pendingConnectionEdges,
      connectingEdges,
      operationTargetEdges,
      contractCallPulseEdges,
      internalLinkEdges,
    ],
  );

  const persist = useCallback(
    (stableId: string, position: Position) => {
      setLayout(saveNodePosition(storage, stableId, position));
    },
    [storage],
  );

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__titles">
          <h1 className="app__title">{t("app.title")}</h1>
          <p className="app__subtitle">{t("app.subtitle")}</p>
        </div>
        <div className="app__controls">
          <StatusBadge status={status} isMock={isMock} />
          <LanguageToggle />
        </div>
      </header>
      <CommandActionsProvider actions={actions}>
        <OperationDataProvider value={{ walletCandidates, deployedContracts }}>
          <main className="app__canvas">
            <CanvasToolbar
              pendingAddNode={pendingAddNode}
              pendingAddWorkbench={pendingAddWorkbench}
              entities={entities}
            />
            {nodes.length === 0 ? (
              <p className="app__empty">{t("canvas.empty")}</p>
            ) : (
              <Canvas nodes={nodes} edges={edges} onPersistPosition={persist} />
            )}
            <ToastStack notifications={notifications} onDismiss={dismiss} />
          </main>
        </OperationDataProvider>
      </CommandActionsProvider>
    </div>
  );
}

export function App({
  clientFactory,
  isMock = clientFactory === undefined,
  glossary = defaultGlossary,
  storage,
}: AppProps = {}) {
  const [store] = useState<KeyValueStorage>(() => storage ?? getBrowserStorage());
  const [factory] = useState<ClientFactory>(
    () => clientFactory ?? ((handlers) => createMockClient(handlers)),
  );

  return (
    <LanguageProvider storage={store}>
      <GlossaryProvider glossary={glossary}>
        <AppShell clientFactory={factory} isMock={isMock} storage={store} />
      </GlossaryProvider>
    </LanguageProvider>
  );
}
