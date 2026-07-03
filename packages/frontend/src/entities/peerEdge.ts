import type { PeerEdge } from "@chainviz/shared";
import type { Edge } from "@xyflow/react";

/**
 * B層のピア接続（紐）を React Flow のエッジに変換するための型・関数。
 *
 * `PeerEdge.fromNodeId` / `toNodeId` はインフラエンティティの安定 ID
 * （= React Flow ノードの `id`）に対応する。エッジはこの ID で
 * ノードカードに接続する。
 */

export interface PeerEdgeData extends Record<string, unknown> {
  /** どの P2P ネットワークに属する接続か。将来の複数チェーン比較で使う。 */
  networkId: string;
}

export type PeerFlowEdge = Edge<PeerEdgeData>;

/**
 * networkId ごとに紐の色を分けるためのパレット。
 * 現状の Ethereum プロファイル1つでは networkId は1種類だが、将来の
 * 複数チェーン比較（Phase 6 以降）でネットワークを見分けられるようにしておく。
 */
export const NETWORK_COLORS: readonly string[] = [
  "#4f9dff",
  "#38d39f",
  "#f5b544",
  "#c77dff",
  "#ff8f6b",
  "#5ad1e8",
];

/** networkId から決定的に色を1つ選ぶ（同じ networkId は常に同じ色）。 */
export function networkIdColor(networkId: string): string {
  let hash = 0;
  for (let i = 0; i < networkId.length; i += 1) {
    hash = (hash * 31 + networkId.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % NETWORK_COLORS.length;
  return NETWORK_COLORS[index];
}

/** networkId を CSS クラス名に使える安全なトークンへ変換する。 */
export function networkClassToken(networkId: string): string {
  return networkId.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/** 無向ペアを順序に依存しない `[小, 大]` に正規化する。 */
function orderedPair(a: string, b: string): [string, string] {
  return a <= b ? [a, b] : [b, a];
}

/**
 * ピア接続（PeerEdge）の配列を React Flow のエッジ配列へ変換する。
 *
 * - 端点のカードが両方存在するエッジだけを描く（宙ぶらりんの紐を避ける）。
 * - P2P 接続は無向なので、同じ networkId・同じノードのペアは（向きが逆でも）
 *   1本の紐にまとめる。
 * - networkId ごとに色分けし、`data.networkId` にグループ情報を持たせる。
 */
export function peerEdgesToFlowEdges(
  edges: PeerEdge[],
  presentNodeIds: Iterable<string>,
): PeerFlowEdge[] {
  const present =
    presentNodeIds instanceof Set
      ? presentNodeIds
      : new Set<string>(presentNodeIds);
  const seen = new Set<string>();
  const result: PeerFlowEdge[] = [];

  for (const edge of edges) {
    if (edge.fromNodeId === edge.toNodeId) continue; // 自己ループは描かない
    if (!present.has(edge.fromNodeId) || !present.has(edge.toNodeId)) continue;

    const [lo, hi] = orderedPair(edge.fromNodeId, edge.toNodeId);
    // networkId 単位でグルーピングするため、networkId が違えば別の紐扱い。
    const key = `${edge.networkId}::${lo}::${hi}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const color = networkIdColor(edge.networkId);
    result.push({
      id: `peer-${key}`,
      source: lo,
      target: hi,
      data: { networkId: edge.networkId },
      className: `peer-edge peer-edge--net-${networkClassToken(edge.networkId)}`,
      style: { stroke: color, strokeWidth: 1.5 },
    });
  }

  return result;
}

/** 描画されるエッジを networkId 単位でまとめる（凡例・集計向け）。 */
export function groupEdgesByNetwork(
  edges: PeerFlowEdge[],
): Map<string, PeerFlowEdge[]> {
  const groups = new Map<string, PeerFlowEdge[]>();
  for (const edge of edges) {
    const networkId = edge.data?.networkId ?? "";
    const bucket = groups.get(networkId);
    if (bucket) bucket.push(edge);
    else groups.set(networkId, [edge]);
  }
  return groups;
}
