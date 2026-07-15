import {
  Background,
  Controls,
  type Edge,
  type EdgeChange,
  MiniMap,
  type Node,
  type NodeTypes,
  type EdgeTypes,
  ReactFlow,
  ReactFlowProvider,
  applyEdgeChanges,
  applyNodeChanges,
  type NodeChange,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChainRibbonCard } from "../entities/ChainRibbonCard.js";
import { CHAIN_RIBBON_NODE_TYPE } from "../entities/chainRibbonNode.js";
import type { LayerFilter } from "../entities/canvasLayers.js";
import { computeLayerVisibility, withLayerDimClassName } from "../entities/canvasLayers.js";
import { ContractCallPulseEdge } from "../entities/ContractCallPulseEdge.js";
import { CONTRACT_CALL_PULSE_EDGE_TYPE } from "../entities/contractCallPulseEdge.js";
import { ContractCard } from "../entities/ContractCard.js";
import { CONTRACT_NODE_TYPE, type ContractFlowNode } from "../entities/contractNode.js";
import {
  buildContractListEntries,
  resolveNodeCenter,
  sortEntriesByAppearance,
} from "../entities/contractList.js";
import { ContractListPanel } from "../entities/ContractListPanel.js";
import { DeployEdge } from "../entities/DeployEdge.js";
import { DEPLOY_EDGE_TYPE, isDeployFlowEdge } from "../entities/deployEdge.js";
import { GhostNodeCard } from "../entities/GhostNodeCard.js";
import { GHOST_NODE_TYPE, type GhostFlowNode } from "../entities/ghostNode.js";
import { InfraNodeCard } from "../entities/InfraNodeCard.js";
import { NEW_ARRIVAL_HIGHLIGHT_DURATION_MS } from "../entities/useNewArrivalHighlight.js";
import { useAppearanceOrder } from "../entities/useAppearanceOrder.js";
import { InternalLinkEdge } from "../entities/InternalLinkEdge.js";
import {
  INTERNAL_LINK_EDGE_TYPE,
  isInternalLinkFlowEdge,
} from "../entities/internalLinkEdge.js";
import { PeerNetworkLegend } from "../entities/PeerNetworkLegend.js";
import { PeerPropagationEdge } from "../entities/PeerPropagationEdge.js";
import { PEER_EDGE_TYPE, isPeerFlowEdge } from "../entities/peerEdge.js";
import { WalletCard } from "../entities/WalletCard.js";
import { WALLET_NODE_TYPE } from "../entities/walletNode.js";
import { OwnershipEdge } from "../entities/OwnershipEdge.js";
import { OWNERSHIP_EDGE_TYPE } from "../entities/ownershipEdge.js";
import { OperationPulseEdge } from "../entities/OperationPulseEdge.js";
import { OPERATION_EDGE_TYPE } from "../entities/operationEdge.js";
import { PendingConnectionEdge } from "../entities/PendingConnectionEdge.js";
import { PENDING_CONNECTION_EDGE_TYPE } from "../entities/pendingConnectionEdge.js";
import { ConnectingEdge } from "../entities/ConnectingEdge.js";
import { CONNECTING_EDGE_TYPE } from "../entities/connectingEdge.js";
import { OperationTargetEdge } from "../entities/OperationTargetEdge.js";
import {
  OPERATION_TARGET_EDGE_TYPE,
  isOperationTargetFlowEdge,
} from "../entities/operationTargetEdge.js";
import {
  type CanvasFlowEdge,
  type CanvasFlowNode,
  canvasNodeLayoutKey,
  preserveMeasuredDimensions,
} from "../entities/canvasNode.js";
import type { Position } from "../layout/layoutStore.js";

// nodeTypes / edgeTypes は再レンダーごとに作り直すと React Flow が警告するため外に出す。
const nodeTypes: NodeTypes = {
  infra: InfraNodeCard,
  [WALLET_NODE_TYPE]: WalletCard,
  [CONTRACT_NODE_TYPE]: ContractCard,
  [GHOST_NODE_TYPE]: GhostNodeCard,
  [CHAIN_RIBBON_NODE_TYPE]: ChainRibbonCard,
};
const edgeTypes: EdgeTypes = {
  [PEER_EDGE_TYPE]: PeerPropagationEdge,
  [OWNERSHIP_EDGE_TYPE]: OwnershipEdge,
  [DEPLOY_EDGE_TYPE]: DeployEdge,
  [OPERATION_EDGE_TYPE]: OperationPulseEdge,
  [PENDING_CONNECTION_EDGE_TYPE]: PendingConnectionEdge,
  [CONNECTING_EDGE_TYPE]: ConnectingEdge,
  [OPERATION_TARGET_EDGE_TYPE]: OperationTargetEdge,
  [CONTRACT_CALL_PULSE_EDGE_TYPE]: ContractCallPulseEdge,
  [INTERNAL_LINK_EDGE_TYPE]: InternalLinkEdge,
};

export interface CanvasProps {
  nodes: CanvasFlowNode[];
  /** キャンバス上のエッジ（B層ピア接続 + C層所有エッジ）。 */
  edges?: CanvasFlowEdge[];
  /** ドラッグ完了時に安定 ID（containerName / address）と位置を保存する。 */
  onPersistPosition: (stableId: string, position: Position) => void;
  /**
   * レイヤーレンズの選択状態（Issue #299）。省略時は "all"（全層通常表示、
   * 既定・見た目は従来どおり変わらない）。選択状態自体は App.tsx が
   * 持つ（`LayerFilterBar` はツールバー直下に別途配置するため）。
   */
  layerFilter?: LayerFilter;
}

function CanvasInner({
  nodes,
  edges = [],
  onPersistPosition,
  layerFilter = "all",
}: CanvasProps) {
  const [rfNodes, setRfNodes] = useState<CanvasFlowNode[]>(nodes);
  const [rfEdges, setRfEdges] = useState<CanvasFlowEdge[]>(edges);
  // ホバー中のピア接続（紐）の id。ホバー強調・ポップオーバー表示
  // （Issue #124 B）に使う。ピア以外のエッジでは常に null のまま。
  const [hoveredPeerEdgeId, setHoveredPeerEdgeId] = useState<string | null>(
    null,
  );
  // ホバー中のデプロイエッジの id。ピア接続と同じ仕組みでホバー強調・
  // ポップオーバー表示を行う（ARCHITECTURE.md §6.3）。デプロイエッジ以外
  // では常に null のまま。
  const [hoveredDeployEdgeId, setHoveredDeployEdgeId] = useState<
    string | null
  >(null);
  // ホバー中の内部リンクエッジ(D層)の id。同じ仕組みでホバー強調・
  // ポップオーバー表示を行う（ARCHITECTURE.md §7.6.3）。内部リンクエッジ
  // 以外では常に null のまま。
  const [hoveredInternalLinkEdgeId, setHoveredInternalLinkEdgeId] = useState<
    string | null
  >(null);
  // ホバー中の操作先エッジの id。同じ仕組みでホバー強調・ポップオーバー
  // 表示を行う（Issue #215）。操作先エッジ以外では常に null のまま。
  const [hoveredOperationTargetEdgeId, setHoveredOperationTargetEdgeId] =
    useState<string | null>(null);
  // コントラクト一覧パネルの行クリックでパンした直後、一時的に新着発光と
  // 同じ強調を当てる対象ノード id（Issue #218/#211「単位C」）。
  // rfNodes 自体は書き換えず、表示直前（displayNodes）でだけ isNew=true を
  // 注入する（peer/deploy エッジの hover 注入と同じパターン）。
  const [jumpHighlightNodeId, setJumpHighlightNodeId] = useState<string | null>(
    null,
  );
  const jumpHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  useEffect(
    () => () => {
      if (jumpHighlightTimerRef.current) {
        clearTimeout(jumpHighlightTimerRef.current);
      }
    },
    [],
  );

  // ワールドステート更新で親が nodes を再計算したら反映する。React Flow は
  // 実測済み(measured)の情報を持たないノードオブジェクトを受け取ると再計測
  // サイクルに入り、一瞬 visibility を hidden にする(Issue #119)。直前まで
  // rfNodes が持っていた実測値を引き継いでから反映することでこれを防ぐ
  // (詳細は canvasNode.ts の preserveMeasuredDimensions を参照)。
  useEffect(() => {
    setRfNodes((current) => preserveMeasuredDimensions(nodes, current));
  }, [nodes]);

  // ピア接続の追加・削除で親が edges を再計算したら反映する。
  useEffect(() => {
    setRfEdges(edges);
  }, [edges]);

  const onNodesChange = useCallback((changes: NodeChange<CanvasFlowNode>[]) => {
    setRfNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<CanvasFlowEdge>[]) => {
    setRfEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      onPersistPosition(
        canvasNodeLayoutKey(node as CanvasFlowNode),
        node.position,
      );
    },
    [onPersistPosition],
  );

  // ピア接続・デプロイエッジだけホバー状態を追う（所有エッジ・操作エッジは
  // ホバー説明の対象外。Issue #124 B、デプロイエッジは ARCHITECTURE.md §6.3、
  // 操作先エッジは Issue #215）。
  const onEdgeMouseEnter = useCallback(
    (_event: unknown, edge: Edge) => {
      if (edge.type === PEER_EDGE_TYPE) setHoveredPeerEdgeId(edge.id);
      if (edge.type === DEPLOY_EDGE_TYPE) setHoveredDeployEdgeId(edge.id);
      if (edge.type === INTERNAL_LINK_EDGE_TYPE) {
        setHoveredInternalLinkEdgeId(edge.id);
      }
      if (edge.type === OPERATION_TARGET_EDGE_TYPE) {
        setHoveredOperationTargetEdgeId(edge.id);
      }
    },
    [],
  );
  const onEdgeMouseLeave = useCallback((_event: unknown, edge: Edge) => {
    if (edge.type === PEER_EDGE_TYPE) {
      setHoveredPeerEdgeId((current) => (current === edge.id ? null : current));
    }
    if (edge.type === DEPLOY_EDGE_TYPE) {
      setHoveredDeployEdgeId((current) =>
        current === edge.id ? null : current,
      );
    }
    if (edge.type === INTERNAL_LINK_EDGE_TYPE) {
      setHoveredInternalLinkEdgeId((current) =>
        current === edge.id ? null : current,
      );
    }
    if (edge.type === OPERATION_TARGET_EDGE_TYPE) {
      setHoveredOperationTargetEdgeId((current) =>
        current === edge.id ? null : current,
      );
    }
  }, []);

  // レイヤーレンズ(Issue #299): 選択層以外の要素の id 集合。"all" のときは
  // 常に空集合(既存の見た目を一切変えない)。rfNodes/rfEdges(hover 注入前の
  // 状態)を入力にする。
  const layerVisibility = useMemo(
    () => computeLayerVisibility(rfNodes, rfEdges, layerFilter),
    [rfNodes, rfEdges, layerFilter],
  );

  // 表示直前にホバー状態・dim状態を注入する。rfEdges 自体は書き換えない
  // （applyEdgeChanges の対象と hover/dim 由来の派生 state を混ぜない）。
  const displayEdges = useMemo(
    () =>
      rfEdges.map((edge) => {
        let next = edge;
        if (isPeerFlowEdge(edge)) {
          const hovered = edge.id === hoveredPeerEdgeId;
          if ((edge.data?.hovered ?? false) !== hovered) {
            next = { ...next, data: { ...next.data, hovered } };
          }
        } else if (isDeployFlowEdge(edge)) {
          const hovered = edge.id === hoveredDeployEdgeId;
          if ((edge.data?.hovered ?? false) !== hovered) {
            next = { ...next, data: { ...next.data, hovered } };
          }
        } else if (isInternalLinkFlowEdge(edge)) {
          const hovered = edge.id === hoveredInternalLinkEdgeId;
          if ((edge.data?.hovered ?? false) !== hovered) {
            next = { ...next, data: { ...next.data, hovered } };
          }
        } else if (isOperationTargetFlowEdge(edge)) {
          const hovered = edge.id === hoveredOperationTargetEdgeId;
          if ((edge.data?.hovered ?? false) !== hovered) {
            next = { ...next, data: { ...next.data, hovered } };
          }
        }

        // dim はホバー中の紐/線でも一旦付けたままにする。実際の見た目の
        // 復帰は styles.css の `.layer-lens-dim:hover` (CSS の :hover は
        // 子要素のホバーでも発火するため、JS 側の hovered state と二重に
        // 判定を持たなくてよい。docs/worklog/issue-299.md 参照)。
        const dim = layerVisibility.dimEdgeIds.has(edge.id);
        const className = withLayerDimClassName(next.className, dim);
        if (className !== next.className) {
          next = { ...next, className };
        }
        return next;
      }),
    [
      rfEdges,
      hoveredPeerEdgeId,
      hoveredDeployEdgeId,
      hoveredInternalLinkEdgeId,
      hoveredOperationTargetEdgeId,
      layerVisibility,
    ],
  );

  // ネットワーク凡例（Issue #124 A）に渡す、現在描画中のピア接続だけの一覧。
  const peerEdges = useMemo(() => rfEdges.filter(isPeerFlowEdge), [rfEdges]);

  // コントラクト一覧パネル（Issue #218/#211「単位C」）に渡す行データ。
  // rfNodes は既にコントラクトカード・デプロイ中のゴーストカードを含んで
  // いるため、App.tsx を経由せずここで filter するだけで揃う
  // （peerEdges と同じ流儀）。
  const contractNodesForList = useMemo(
    () =>
      rfNodes.filter(
        (node): node is ContractFlowNode => node.type === CONTRACT_NODE_TYPE,
      ),
    [rfNodes],
  );
  const deployingGhostsForList = useMemo(
    () =>
      rfNodes.filter(
        (node): node is GhostFlowNode =>
          node.type === GHOST_NODE_TYPE && node.data.kind === "contract",
      ),
    [rfNodes],
  );
  const contractListEntries = useMemo(
    () => buildContractListEntries(contractNodesForList, deployingGhostsForList),
    [contractNodesForList, deployingGhostsForList],
  );
  const contractListIds = useMemo(
    () => contractListEntries.map((entry) => entry.nodeId),
    [contractListEntries],
  );
  const contractListOrder = useAppearanceOrder(contractListIds);
  const sortedContractListEntries = useMemo(
    () => sortEntriesByAppearance(contractListEntries, contractListOrder),
    [contractListEntries, contractListOrder],
  );

  const { getNode, setCenter, getZoom } = useReactFlow();

  // コントラクト一覧パネルの行クリック。対象カードへパンし（ズーム倍率は
  // 現状維持。Miro的な操作感を保つため、ユーザーのクリック以外でカメラを
  // 動かさない）、実カード（コントラクトカード）が対象のときだけ一時的な
  // 強調を当てる（ARCHITECTURE.md／docs/worklog/issue-211.md「単位C」）。
  const handleJumpToContract = useCallback(
    (nodeId: string) => {
      const node = getNode(nodeId);
      if (!node) return;
      const center = resolveNodeCenter(node.position, node.measured);
      setCenter(center.x, center.y, { zoom: getZoom(), duration: 400 });

      if (node.type !== CONTRACT_NODE_TYPE) return; // ghost カードは spinner 演出で十分
      if (jumpHighlightTimerRef.current) {
        clearTimeout(jumpHighlightTimerRef.current);
      }
      setJumpHighlightNodeId(nodeId);
      jumpHighlightTimerRef.current = setTimeout(() => {
        setJumpHighlightNodeId(null);
      }, NEW_ARRIVAL_HIGHLIGHT_DURATION_MS);
    },
    [getNode, setCenter, getZoom],
  );

  // 表示直前にジャンプ強調・レイヤーレンズの dim 状態を注入する
  // （displayEdges の hover/dim 注入と同じパターン）。rfNodes 自体・各
  // NodeData の型は変えない。ゴーストカード・新着発光中のカードは
  // layerVisibility.dimNodeIds に含まれないため常に対象外になる
  // （entities/canvasLayers.ts の computeLayerVisibility 参照）。
  const displayNodes = useMemo(
    () =>
      rfNodes.map((node) => {
        let next = node;
        if (jumpHighlightNodeId !== null && node.id === jumpHighlightNodeId && node.type === CONTRACT_NODE_TYPE) {
          next = { ...node, data: { ...node.data, isNew: true } };
        }
        const dim = layerVisibility.dimNodeIds.has(node.id);
        const className = withLayerDimClassName(next.className, dim);
        if (className !== next.className) {
          next = { ...next, className };
        }
        return next;
      }),
    [rfNodes, jumpHighlightNodeId, layerVisibility],
  );

  return (
    <ReactFlow
      nodes={displayNodes}
      edges={displayEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onEdgeMouseEnter={onEdgeMouseEnter}
      onEdgeMouseLeave={onEdgeMouseLeave}
      fitView
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      // React Flow の Controls / MiniMap は既定でライトテーマ（白背景）の
      // まま描画され、アプリ全体のダークな配色から浮いて見づらかった。
      // React Flow 標準のダークテーマ変数に切り替える（Issue #32）。
      colorMode="dark"
    >
      {/* colorMode="dark" にすると React Flow が --xy-background-color-default
          (#141414) を定義し、Background 既定色がその無彩色グレーになる。
          アプリのパレット（紺色 --bg #0f1420）から色相が外れるため、
          bgColor を明示してキャンバス背景をアプリ側と揃えていた（Issue #32）。
          Issue #327 では「静かな夜のガラス」デザインの一環でキャンバス実背景に
          淡い色光のラジアルグラデーションを敷くため、bgColor は transparent に
          し、実際の塗りは styles.css の `.app__canvas .react-flow` に持たせる
          （そちらのコメントで `.react-flow` 自体が敷く #141414 の上書きも
          説明している）。 */}
      <Background bgColor="transparent" />
      <Controls />
      <MiniMap pannable zoomable />
      <PeerNetworkLegend edges={peerEdges} />
      <ContractListPanel
        entries={sortedContractListEntries}
        onSelect={handleJumpToContract}
      />
    </ReactFlow>
  );
}

/** ズーム/パン/ドラッグができる無限キャンバス（React Flow の土台）。 */
export function Canvas(props: CanvasProps) {
  return (
    <ReactFlowProvider>
      <CanvasInner {...props} />
    </ReactFlowProvider>
  );
}
