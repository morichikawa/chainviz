import type {
  BlockEntity,
  TransactionEntity,
  WalletEntity,
} from "@chainviz/shared";
import { useCallback, useMemo, useState } from "react";
import { Canvas } from "../canvas/Canvas.js";
import { CanvasToolbar } from "../canvas/CanvasToolbar.js";
import { CommandActionsProvider } from "../commands/CommandActionsContext.js";
import { useCommands } from "../commands/useCommands.js";
import { ToastStack } from "../notifications/Toast.js";
import { useNotifications } from "../notifications/useNotifications.js";
import { attachPulsesToEdges } from "../entities/blockPulse.js";
import { entitiesToFlowNodes } from "../entities/infraNode.js";
import { peerEdgesToFlowEdges } from "../entities/peerEdge.js";
import { ownershipEdgesToFlowEdges } from "../entities/ownershipEdge.js";
import { indexTransactions } from "../entities/transaction.js";
import { useBlockPulses } from "../entities/useBlockPulses.js";
import { useOperationPulses } from "../entities/useOperationPulses.js";
import { useTxLifecycle } from "../entities/useTxLifecycle.js";
import { walletsToFlowNodes } from "../entities/walletNode.js";
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

  const { state, status, operations, actions, ghosts } = useCommands(
    clientFactory,
    notify,
    t,
  );

  const entities = useMemo(() => listEntities(state), [state]);

  const infraNodes = useMemo(
    () => entitiesToFlowNodes(entities, layout),
    [entities, layout],
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

  const walletNodes = useMemo(
    () =>
      walletsToFlowNodes(wallets, {
        layout,
        txByHash,
        settling,
        presentInfraIds: infraNodeIds,
      }),
    [wallets, layout, txByHash, settling, infraNodeIds],
  );

  // ワークベンチ → ウォレットの所有エッジ（点線・別色で B層のピア接続と区別）。
  const ownershipEdges = useMemo(
    () => ownershipEdgesToFlowEdges(wallets, infraNodeIds),
    [wallets, infraNodeIds],
  );

  // ワークベンチ → ノードの操作（RPC 呼び出し）を、観測された瞬間だけ一時的な
  // エッジ + パルスとして描く（走り終わると消える揮発性のエッジ）。
  const operationEdges = useOperationPulses(operations, infraNodeIds);

  const nodes = useMemo(
    () => [...infraNodes, ...walletNodes, ...ghosts],
    [infraNodes, walletNodes, ghosts],
  );
  const edges = useMemo(
    () => [...peerEdgesWithPulses, ...ownershipEdges, ...operationEdges],
    [peerEdgesWithPulses, ownershipEdges, operationEdges],
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
          <CanvasToolbar />
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
