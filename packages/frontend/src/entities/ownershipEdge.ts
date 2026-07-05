import type { WalletEntity } from "@chainviz/shared";
import type { Edge } from "@xyflow/react";

/**
 * ワークベンチ → ウォレットの「所有」エッジ。秘密鍵を持つワークベンチが
 * どのウォレット（アドレス）を操作しているかを示す（CONCEPT.md「鍵の在り処との
 * リンク」）。B層の P2P ピア接続（PeerEdge）とは意味が別物なので、描画側
 * （OwnershipEdge.tsx）で点線・別色にして視覚的に区別する。
 *
 * このエッジはワールドステートの `edges`（PeerEdge のみ）には含まれず、
 * `WalletEntity.ownerWorkbenchId` から都度導出する。所有者が削除されると
 * collector 側で ownerWorkbenchId が null になり、エッジは自然に消える
 * （ウォレットカード側で「所有者削除済み」を示す）。
 */

export type OwnershipEdgeData = Record<string, unknown>;

export type OwnershipFlowEdge = Edge<OwnershipEdgeData>;

/** React Flow の edgeTypes で使う所有エッジの型名。 */
export const OWNERSHIP_EDGE_TYPE = "ownership";

/**
 * ウォレット群から所有エッジ（ワークベンチ → ウォレット）を導出する。
 *
 * - `ownerWorkbenchId` が null のウォレット（所有者削除済み）はエッジを作らない。
 * - 所有者のワークベンチが現在キャンバスに存在しない場合も作らない（宙ぶらりんの
 *   エッジを避ける）。
 * - source = ワークベンチの安定 ID、target = ウォレットの address。
 */
export function ownershipEdgesToFlowEdges(
  wallets: WalletEntity[],
  presentInfraIds: Iterable<string>,
): OwnershipFlowEdge[] {
  const present =
    presentInfraIds instanceof Set
      ? presentInfraIds
      : new Set<string>(presentInfraIds);
  const result: OwnershipFlowEdge[] = [];

  for (const wallet of wallets) {
    const owner = wallet.ownerWorkbenchId;
    if (owner === null) continue;
    if (!present.has(owner)) continue;

    result.push({
      id: `own-${owner}-${wallet.address}`,
      type: OWNERSHIP_EDGE_TYPE,
      source: owner,
      target: wallet.address,
      className: "ownership-edge",
    });
  }

  return result;
}
