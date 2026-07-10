import type { NodeEntity, WorkbenchEntity } from "@chainviz/shared";
import type { Edge } from "@xyflow/react";

/**
 * ワークベンチ → RPC 接続先ノードの常設「操作先」エッジ（Issue #123 UX設計
 * §4-4）。揮発性の操作パルス（operationEdge.ts）と違い、`rpcTargetNodeId` が
 * 解決できている間はずっと表示され続ける（実際に RPC 呼び出しが起きたかどうか
 * に関係なく、「操作すればここへ向かう」という関係を常に示す）。
 *
 * Issue #215 でホバーポップオーバー（`OperationTargetEdgePopover`）を追加
 * するにあたり、端点の containerName と hover 状態を data に持たせる
 * （`internalLinkEdge.ts`/`deployEdge.ts` と同じ流儀）。
 */

export const OPERATION_TARGET_EDGE_TYPE = "operationTarget";

export interface OperationTargetEdgeData extends Record<string, unknown> {
  /** ポップオーバー端点表記用: ワークベンチの containerName。 */
  workbenchContainerName: string;
  /** ポップオーバー端点表記用: 操作先ノードの containerName。 */
  targetContainerName: string;
  /** 現在このエッジがホバーされているか（Canvas.tsx がホバー状態から注入する）。 */
  hovered?: boolean;
}

export type OperationTargetFlowEdge = Edge<OperationTargetEdgeData>;

/**
 * キャンバスの合併エッジ型から操作先エッジだけを絞り込む型ガード
 * （`isPeerFlowEdge`/`isDeployFlowEdge`/`isInternalLinkFlowEdge` と同じ狙い。
 * Canvas.tsx のホバー処理で使う。Issue #215）。
 */
export function isOperationTargetFlowEdge(
  edge: Edge,
): edge is OperationTargetFlowEdge {
  return edge.type === OPERATION_TARGET_EDGE_TYPE;
}

/**
 * ワークベンチ群から常設の操作先エッジを導出する。
 *
 * - `rpcTargetNodeId` を解決できていないワークベンチはスキップする（collector
 *   未対応・旧スナップショットとの互換。Issue #123 §4-5）。
 * - 端点（ワークベンチ・対象ノード）の両方が現在キャンバス上に存在しないと
 *   描かない（宙ぶらりんのエッジを避ける。対象ノードが削除された場合など）。
 * - `nodes` は対象ノードの containerName 解決にのみ使う（`internalLinkEdge.ts`
 *   の `internalLinkEdgesToFlowEdges` と同じ内部 `nodesById` 構築パターン）。
 *   対象ノードが `present` に含まれていても `nodes` 配列に無い（呼び出し元の
 *   不整合）場合は解決できないため描かない（ダングリングガードと同様に扱う）。
 */
export function operationTargetEdgesToFlowEdges(
  workbenches: WorkbenchEntity[],
  nodes: NodeEntity[],
  presentInfraIds: Iterable<string>,
): OperationTargetFlowEdge[] {
  const present =
    presentInfraIds instanceof Set
      ? presentInfraIds
      : new Set<string>(presentInfraIds);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const result: OperationTargetFlowEdge[] = [];

  for (const workbench of workbenches) {
    const targetId = workbench.rpcTargetNodeId;
    if (!targetId) continue;
    if (!present.has(workbench.id) || !present.has(targetId)) continue;
    const target = nodesById.get(targetId);
    if (!target) continue; // 解決できない（ノード一覧に無い）対象は描かない

    result.push({
      id: `optarget-${workbench.id}`,
      type: OPERATION_TARGET_EDGE_TYPE,
      source: workbench.id,
      target: targetId,
      className: "operation-target-edge",
      data: {
        workbenchContainerName: workbench.containerName,
        targetContainerName: target.containerName,
      },
    });
  }

  return result;
}
