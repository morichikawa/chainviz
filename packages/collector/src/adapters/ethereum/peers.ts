// 各ノードから集めたピア情報を、チェーン非依存な PeerEdge へ正規化する
// 純粋関数。P2P 識別子（CL の libp2p peer_id / EL の enode 公開鍵）は
// この層で安定識別子（NodeEntity.id）へ解決し、ワールドステートには
// P2P 識別子を漏らさない。
//
// 入力の NodePeers は「識別子の名前空間が揃った 1 つの P2P ネットワーク」
// 単位で渡すこと（CL と EL では識別子の体系が異なるため、混ぜずに
// それぞれ別々に toPeerEdges を呼び、結果を連結する）。

import type { PeerEdge } from "@chainviz/shared";

/**
 * 1 ノードから観測したピア情報。CL（Beacon API）・EL（admin_peers）どちらの
 * 観測結果もこの形へ揃えてから toPeerEdges へ渡す。
 */
export interface NodePeers {
  /** このノードの安定識別子（NodeEntity.id）。 */
  stableId: string;
  /** このノード自身の P2P 識別子（libp2p peer_id / enode 公開鍵など）。 */
  peerId: string;
  /** グルーピング用ネットワーク ID。 */
  networkId: string;
  /** このノードが接続している相手の P2P 識別子一覧。 */
  connectedPeerIds: string[];
}

/** 無向エッジの正規キー（fromNodeId <= toNodeId になるよう並べる）。 */
function orderedPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

/**
 * ノード群のピア情報を PeerEdge[] へ正規化する。
 * - P2P 識別子を安定識別子へ解決できたピアのみエッジにする
 *   （観測対象外のノードとの接続は落とす）
 * - 自己ループは除外する
 * - A→B と B→A は同一の接続なので無向エッジとして 1 本に畳む
 */
export function toPeerEdges(nodes: NodePeers[]): PeerEdge[] {
  const peerIdToStableId = new Map<string, string>();
  for (const node of nodes) {
    if (node.peerId) peerIdToStableId.set(node.peerId, node.stableId);
  }

  const seen = new Set<string>();
  const edges: PeerEdge[] = [];
  for (const node of nodes) {
    for (const peerId of node.connectedPeerIds) {
      const otherStableId = peerIdToStableId.get(peerId);
      if (!otherStableId) continue;
      if (otherStableId === node.stableId) continue;
      const [from, to] = orderedPair(node.stableId, otherStableId);
      const key = `${from}|${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({
        kind: "peer",
        fromNodeId: from,
        toNodeId: to,
        networkId: node.networkId,
      });
    }
  }
  return edges;
}
