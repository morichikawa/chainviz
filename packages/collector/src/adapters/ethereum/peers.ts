// ビーコンノードから集めたピア情報を、チェーン非依存な PeerEdge へ正規化する
// 純粋関数。peer_id はこの層で安定識別子（NodeEntity.id）へ解決し、
// ワールドステートには peer_id を漏らさない。

import type { PeerEdge } from "@chainviz/shared";

/** 1 ビーコンノードから観測したピア情報。 */
export interface BeaconNodePeers {
  /** このノードの安定識別子（NodeEntity.id）。 */
  stableId: string;
  /** このノード自身の peer_id。 */
  peerId: string;
  /** グルーピング用ネットワーク ID。 */
  networkId: string;
  /** このノードが接続している相手の peer_id 一覧。 */
  connectedPeerIds: string[];
}

/** 無向エッジの正規キー（fromNodeId <= toNodeId になるよう並べる）。 */
function orderedPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

/**
 * ビーコンノード群のピア情報を PeerEdge[] へ正規化する。
 * - peer_id を安定識別子へ解決できたピアのみエッジにする
 *   （観測対象外のノードとの接続は落とす）
 * - 自己ループは除外する
 * - A→B と B→A は同一の接続なので無向エッジとして 1 本に畳む
 */
export function toPeerEdges(nodes: BeaconNodePeers[]): PeerEdge[] {
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
