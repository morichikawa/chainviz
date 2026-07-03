import {
  Background,
  Controls,
  MiniMap,
  type Node,
  type NodeTypes,
  ReactFlow,
  ReactFlowProvider,
  applyNodeChanges,
  type NodeChange,
} from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { InfraNodeCard } from "../entities/InfraNodeCard.js";
import type { InfraFlowNode } from "../entities/infraNode.js";
import type { Position } from "../layout/layoutStore.js";

// nodeTypes は再レンダーごとに作り直すと React Flow が警告するため外に出す。
const nodeTypes: NodeTypes = { infra: InfraNodeCard };

export interface CanvasProps {
  nodes: InfraFlowNode[];
  /** ドラッグ完了時に安定 ID（containerName）と位置を保存するコールバック。 */
  onPersistPosition: (stableId: string, position: Position) => void;
}

function CanvasInner({ nodes, onPersistPosition }: CanvasProps) {
  const [rfNodes, setRfNodes] = useState<InfraFlowNode[]>(nodes);

  // ワールドステート更新で親が nodes を再計算したら反映する。
  useEffect(() => {
    setRfNodes(nodes);
  }, [nodes]);

  const onNodesChange = useCallback((changes: NodeChange<InfraFlowNode>[]) => {
    setRfNodes((current) => applyNodeChanges(changes, current));
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
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeDragStop={onNodeDragStop}
      fitView
      minZoom={0.2}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
    >
      <Background />
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
