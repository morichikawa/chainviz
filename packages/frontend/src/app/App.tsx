import type {
  BlockEntity,
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
  type InfraFlowNode,
  entitiesToFlowNodes,
  isInfraEntity,
  isSameInfraNode,
  resolveLayoutPositions,
} from "../entities/infraNode.js";
import { peerEdgesToFlowEdges } from "../entities/peerEdge.js";
import { ownershipEdgesToFlowEdges } from "../entities/ownershipEdge.js";
import { operationTargetEdgesToFlowEdges } from "../entities/operationTargetEdge.js";
import { ghostsToPendingConnectionEdges } from "../entities/pendingConnectionEdge.js";
import { stabilizeNodes } from "../entities/nodeStability.js";
import { indexTransactions } from "../entities/transaction.js";
import { useBlockPulses } from "../entities/useBlockPulses.js";
import { useNewArrivalHighlight } from "../entities/useNewArrivalHighlight.js";
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
    <span className={`status-badge status-badge--${status}`}>
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

  const { state, status, hasReceivedSnapshot, operations, actions, ghosts } =
    useCommands(clientFactory, notify, t);

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

  // 実カード到着からの新着強調（Issue #123 UX設計 §4-4）。
  const infraEntityIds = useMemo(
    () => entities.filter(isInfraEntity).map((entity) => entity.id),
    [entities],
  );
  // 最初のスナップショット到着前は判定・基準確立とも行わない
  // （useNewArrivalHighlight のdocstring参照。`status === "connected"`は
  // WebSocketの接続確立時点であり、その後に届くスナップショットとは
  // タイミングがずれるため使わない。実クライアントでは両者の間に
  // 「connectedだがentitiesは空」のレンダーが挟まり得る）。
  const newArrivals = useNewArrivalHighlight(infraEntityIds, hasReceivedSnapshot);

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

  // 新着強調フラグ（isNew）は「時間経過」に依存し isSameInfraNode の比較対象
  // ではないため、stabilizeNodes の後段で後付けする（entities/infraNode.ts の
  // InfraNodeData docstring参照）。実際に isNew が変化したノードだけ新しい
  // オブジェクトにする（変化の無いノードの参照は保つ。Issue #119対策の効果を
  // 損なわないため）。
  const infraNodesWithHighlight = useMemo(
    () =>
      infraNodes.map((node) => {
        const isNew = newArrivals.has(node.id);
        if (isNew === (node.data.isNew ?? false)) return node;
        return { ...node, data: { ...node.data, isNew } };
      }),
    [infraNodes, newArrivals],
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
      }),
      previousWalletNodesRef.current,
      isSameWalletNode,
    );
    previousWalletNodesRef.current = next;
    return next;
  }, [wallets, layout, txByHash, settling, infraNodeIds]);

  // ワークベンチ → ウォレットの所有エッジ（点線・別色で B層のピア接続と区別）。
  const ownershipEdges = useMemo(
    () => ownershipEdgesToFlowEdges(wallets, infraNodeIds),
    [wallets, infraNodeIds],
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
  const operationTargetEdges = useMemo(
    () => operationTargetEdgesToFlowEdges(workbenchEntities, infraNodeIds),
    [workbenchEntities, infraNodeIds],
  );

  const nodes = useMemo(
    () => [...infraNodesWithHighlight, ...walletNodes, ...ghosts],
    [infraNodesWithHighlight, walletNodes, ghosts],
  );
  const edges = useMemo(
    () => [
      ...peerEdgesWithPulses,
      ...ownershipEdges,
      ...operationEdges,
      ...pendingConnectionEdges,
      ...connectingEdges,
      ...operationTargetEdges,
    ],
    [
      peerEdgesWithPulses,
      ownershipEdges,
      operationEdges,
      pendingConnectionEdges,
      connectingEdges,
      operationTargetEdges,
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
