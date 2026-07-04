import {
  Background,
  Controls,
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
} from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { InfraNodeCard } from "../entities/InfraNodeCard.js";
import type { InfraFlowNode } from "../entities/infraNode.js";
import { PeerPropagationEdge } from "../entities/PeerPropagationEdge.js";
import { PEER_EDGE_TYPE, type PeerFlowEdge } from "../entities/peerEdge.js";
import type { Position } from "../layout/layoutStore.js";

// nodeTypes / edgeTypes は再レンダーごとに作り直すと React Flow が警告するため外に出す。
const nodeTypes: NodeTypes = { infra: InfraNodeCard };
const edgeTypes: EdgeTypes = { [PEER_EDGE_TYPE]: PeerPropagationEdge };

export interface CanvasProps {
  nodes: InfraFlowNode[];
  /** ノード間の P2P ピア接続（B層の紐）。 */
  edges?: PeerFlowEdge[];
  /** ドラッグ完了時に安定 ID（containerName）と位置を保存するコールバック。 */
  onPersistPosition: (stableId: string, position: Position) => void;
}

function CanvasInner({ nodes, edges = [], onPersistPosition }: CanvasProps) {
  const [rfNodes, setRfNodes] = useState<InfraFlowNode[]>(nodes);
  const [rfEdges, setRfEdges] = useState<PeerFlowEdge[]>(edges);

  // ワールドステート更新で親が nodes を再計算したら反映する。
  useEffect(() => {
    setRfNodes(nodes);
  }, [nodes]);

  // ピア接続の追加・削除で親が edges を再計算したら反映する。
  useEffect(() => {
    setRfEdges(edges);
  }, [edges]);

  const onNodesChange = useCallback((changes: NodeChange<InfraFlowNode>[]) => {
    setRfNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const onEdgesChange = useCallback((changes: EdgeChange<PeerFlowEdge>[]) => {
    setRfEdges((current) => applyEdgeChanges(changes, current));
  }, []);

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      const data = node.data as InfraFlowNode["data"];
      onPersistPosition(data.entity.containerName, node.position);
    },
    [onPersistPosition],
  );

  return (
    <ReactFlow
      nodes={rfNodes}
      edges={rfEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
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
          bgColor を明示してキャンバス背景をアプリ側と揃える（Issue #32）。 */}
      <Background bgColor="var(--bg)" />
      <Controls />
      <MiniMap pannable zoomable />
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
