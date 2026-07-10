import type { NodeEntity, PeerEdge } from "@chainviz/shared";
import type { Edge } from "@xyflow/react";
import { clientCategory } from "./clientCategory.js";
import type { BootNodes } from "./connectionTargets.js";

/**
 * 実カード到着後、そのノードを端点とする実 PeerEdge が1本も届いていない間だけ
 * 表示する「接続確立中」の仮エッジ（Issue #123 UX設計 §4-4）。
 *
 * ゴースト由来の接続予定エッジ（pendingConnectionEdge.ts）とは別に、ここでは
 * 「現在の実エンティティ・実エッジの状態」だけから毎回導出する（ゴースト側の
 * 状態を引き継ぐ必要がない）。そのノードが（新規追加に限らず）まだ1本も
 * ピア接続を確立できていない間、対応する層のブートノードへ向けて描く。
 */

export const CONNECTING_EDGE_TYPE = "connecting";

export type ConnectingEdgeData = Record<string, unknown>;

export type ConnectingFlowEdge = Edge<ConnectingEdgeData>;

/**
 * `nodes` のうち、実PeerEdgeを1本も持たないノードから、対応する層の
 * ブートノードへの接続確立中エッジを導出する。
 *
 * - ブートノード自身（`bootNodes` に載っているノード）は対象外（自己ループを
 *   避ける。ブートノード自体は「入口」であり接続確立中の表示は不要）。
 * - クライアント種別が execution/consensus のどちらにも属さない場合、または
 *   対応する層のブートノードが解決できない場合はスキップする（§4-5）。
 * - 端点（自ノード・ブートノード）の両方が現在キャンバス上に存在しないと描かない。
 * - P2P ネットワークに参加しないノード（`p2pRole: "none"`。Ethereum プロファイル
 *   では validator client が該当）は、PeerEdge を永久に持ち得ないため対象外
 *   （Issue #214）。`p2pRole` 省略（undefined）時は従来どおり対象に含める。
 */
export function connectingEdgesToFlowEdges(
  nodes: NodeEntity[],
  peerEdges: PeerEdge[],
  bootNodes: BootNodes,
  presentInfraIds: Iterable<string>,
): ConnectingFlowEdge[] {
  const present =
    presentInfraIds instanceof Set
      ? presentInfraIds
      : new Set<string>(presentInfraIds);

  const connected = new Set<string>();
  for (const edge of peerEdges) {
    connected.add(edge.fromNodeId);
    connected.add(edge.toNodeId);
  }

  const result: ConnectingFlowEdge[] = [];
  for (const node of nodes) {
    if (connected.has(node.id)) continue; // 実エッジが1本でもあれば対象外
    if (node.p2pRole === "none") continue; // P2P非参加ノード（Issue #214）

    const category = clientCategory(node.clientType);
    const boot =
      category === "execution"
        ? bootNodes.execution
        : category === "consensus"
          ? bootNodes.consensus
          : undefined;
    if (!boot) continue;
    if (boot.id === node.id) continue; // ブートノード自身には描かない

    if (!present.has(node.id) || !present.has(boot.id)) continue;

    result.push({
      id: `connecting-${node.id}`,
      type: CONNECTING_EDGE_TYPE,
      source: node.id,
      target: boot.id,
      className: "connecting-edge",
    });
  }

  return result;
}
