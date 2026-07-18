import { useEffect, useRef } from "react";
import { useNodesInitialized, useReactFlow } from "@xyflow/react";
import type { CanvasFlowNode } from "../entities/canvasNode.js";
import { INITIAL_FIT_MAX_ZOOM, shouldPerformInitialFit } from "./initialFit.js";

/**
 * キャンバスの初期フィット（ARCHITECTURE.md §14、initialFit.ts 参照）の
 * React 配線。`ReactFlowProvider` 配下（`CanvasInner` 内）でのみ呼び出せる。
 *
 * `nodes` は React Flow へ実際に渡しているノード配列（`CanvasInner` の
 * `rfNodes`／`displayNodes`。id 集合はどちらも同じ）を渡すこと。
 *
 * `useLayoutEffect` ではなく `useEffect` を使う: React Flow は計測未完了の
 * ノードを可視化せずに描画するため、計測完了コミットの直後に未フィット状態が
 * 一瞬見える理論上の窓があっても実害はほぼ無い（設計メモ§8参照）。
 */
export function useInitialFit(
  hasReceivedSnapshot: boolean,
  nodes: CanvasFlowNode[],
): void {
  const nodesInitialized = useNodesInitialized();
  const { getNodes, fitView } = useReactFlow();
  const firedRef = useRef(false);

  useEffect(() => {
    const shouldFit = shouldPerformInitialFit({
      alreadyFitted: firedRef.current,
      hasReceivedSnapshot,
      nodesInitialized,
      expectedNodeIds: nodes.map((node) => node.id),
      storeNodeIds: getNodes().map((node) => node.id),
    });
    if (!shouldFit) return;

    firedRef.current = true;
    fitView({ maxZoom: INITIAL_FIT_MAX_ZOOM });
  }, [hasReceivedSnapshot, nodesInitialized, nodes, getNodes, fitView]);
}
