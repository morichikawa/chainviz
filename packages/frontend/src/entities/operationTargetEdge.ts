import type { WorkbenchEntity } from "@chainviz/shared";
import type { Edge } from "@xyflow/react";

/**
 * ワークベンチ → RPC 接続先ノードの常設「操作先」エッジ（Issue #123 UX設計
 * §4-4）。揮発性の操作パルス（operationEdge.ts）と違い、`rpcTargetNodeId` が
 * 解決できている間はずっと表示され続ける（実際に RPC 呼び出しが起きたかどうか
 * に関係なく、「操作すればここへ向かう」という関係を常に示す）。
 */

export const OPERATION_TARGET_EDGE_TYPE = "operationTarget";

export type OperationTargetEdgeData = Record<string, unknown>;

export type OperationTargetFlowEdge = Edge<OperationTargetEdgeData>;

/**
 * ワークベンチ群から常設の操作先エッジを導出する。
 *
 * - `rpcTargetNodeId` を解決できていないワークベンチはスキップする（collector
 *   未対応・旧スナップショットとの互換。Issue #123 §4-5）。
 * - 端点（ワークベンチ・対象ノード）の両方が現在キャンバス上に存在しないと
 *   描かない（宙ぶらりんのエッジを避ける。対象ノードが削除された場合など）。
 */
export function operationTargetEdgesToFlowEdges(
  workbenches: WorkbenchEntity[],
  presentInfraIds: Iterable<string>,
): OperationTargetFlowEdge[] {
  const present =
    presentInfraIds instanceof Set
      ? presentInfraIds
      : new Set<string>(presentInfraIds);
  const result: OperationTargetFlowEdge[] = [];

  for (const workbench of workbenches) {
    const targetId = workbench.rpcTargetNodeId;
    if (!targetId) continue;
    if (!present.has(workbench.id) || !present.has(targetId)) continue;

    result.push({
      id: `optarget-${workbench.id}`,
      type: OPERATION_TARGET_EDGE_TYPE,
      source: workbench.id,
      target: targetId,
      className: "operation-target-edge",
    });
  }

  return result;
}
