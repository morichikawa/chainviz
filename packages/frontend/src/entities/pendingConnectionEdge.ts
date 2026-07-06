import type { Edge } from "@xyflow/react";
import type { GhostFlowNode } from "./ghostNode.js";

/**
 * ゴースト（仮カード）から接続予定先ノードへ引く「接続予定エッジ」（Issue #123
 * UX設計 §4-2）。まだ実接続ではないことを示すため、実エッジ（PeerEdge /
 * 操作エッジ）と同系色ながら低彩度・点線にする（実際のスタイルは
 * PendingConnectionEdge.tsx / styles.css）。
 *
 * ゴーストが実カードへ入れ替わる（=`ghosts` 配列から消える）と、この関数の
 * 出力からも自然に消える。実カード到着後の「接続確立中」表示は、この
 * ゴースト起点のエッジとは別に entities/connectingEdge.ts が実エンティティ
 * から導出する（ゴースト固有の状態を引き継ぐ必要がない設計）。
 */

export const PENDING_CONNECTION_EDGE_TYPE = "pendingConnection";

export type PendingConnectionEdgeData = Record<string, unknown>;

export type PendingConnectionFlowEdge = Edge<PendingConnectionEdgeData>;

/**
 * ゴースト配列から接続予定エッジを導出する。
 *
 * - `targetNodeId` を解決できていないゴースト（§4-5 フォールバック）はスキップする。
 * - 接続予定先が現在キャンバス上に存在しない場合もスキップする（宙ぶらりんの
 *   エッジを避ける。ブートノード自体が削除された直後などに起こりうる）。
 * - workbench ゴーストは操作エッジ系の低彩度、node ゴーストはピア接続系の
 *   低彩度にするため、`className` で区別する（実際の色は styles.css）。
 */
export function ghostsToPendingConnectionEdges(
  ghosts: GhostFlowNode[],
  presentInfraIds: Iterable<string>,
): PendingConnectionFlowEdge[] {
  const present =
    presentInfraIds instanceof Set
      ? presentInfraIds
      : new Set<string>(presentInfraIds);
  const result: PendingConnectionFlowEdge[] = [];

  for (const ghost of ghosts) {
    const targetId = ghost.data.targetNodeId;
    if (!targetId) continue;
    if (!present.has(targetId)) continue;

    const colorVariant =
      ghost.data.kind === "workbench"
        ? "pending-connection-edge--operation"
        : "pending-connection-edge--peer";

    result.push({
      id: `pending-${ghost.id}`,
      type: PENDING_CONNECTION_EDGE_TYPE,
      source: ghost.id,
      target: targetId,
      className: `pending-connection-edge ${colorVariant}`,
    });
  }

  return result;
}
