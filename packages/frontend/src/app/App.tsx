import type { BlockEntity } from "@chainviz/shared";
import { useCallback, useMemo, useState } from "react";
import { Canvas } from "../canvas/Canvas.js";
import { attachPulsesToEdges } from "../entities/blockPulse.js";
import { entitiesToFlowNodes } from "../entities/infraNode.js";
import { peerEdgesToFlowEdges } from "../entities/peerEdge.js";
import { useBlockPulses } from "../entities/useBlockPulses.js";
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
import { type ClientFactory, useWorldState } from "../world-state/useWorldState.js";

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

  const { state, status } = useWorldState(clientFactory);

  const nodes = useMemo(
    () => entitiesToFlowNodes(listEntities(state), layout),
    [state, layout],
  );

  // B層のピア接続。端点が両方カードとして存在する紐だけを描く。
  const edges = useMemo(
    () => peerEdgesToFlowEdges(listEdges(state), nodes.map((n) => n.id)),
    [state, nodes],
  );

  // ブロックの受信時刻差から伝播パルスを算出し、エッジ上へ走らせる。
  const blocks = useMemo(
    () =>
      listEntities(state).filter(
        (entity): entity is BlockEntity => entity.kind === "block",
      ),
    [state],
  );
  const activePulses = useBlockPulses(blocks, edges);
  const edgesWithPulses = useMemo(
    () => attachPulsesToEdges(edges, activePulses),
    [edges, activePulses],
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
      <main className="app__canvas">
        {nodes.length === 0 ? (
          <p className="app__empty">{t("canvas.empty")}</p>
        ) : (
          <Canvas
            nodes={nodes}
            edges={edgesWithPulses}
            onPersistPosition={persist}
          />
        )}
      </main>
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
