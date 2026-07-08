import type { ContractEntity } from "@chainviz/shared";
import type { Edge } from "@xyflow/react";

/**
 * ウォレット → コントラクトの「デプロイ」エッジ（ARCHITECTURE.md §6.3
 * 「デプロイエッジ（常設）」）。`deployerAddress` に一致するウォレットが
 * キャンバス上に存在する場合のみ描く常設の細線で、B層の P2P ピア接続
 * （PeerEdge）・C層の所有エッジ（OwnershipEdge）とは別の意味（誰がこの
 * コントラクトを配置したか）を表す。
 *
 * このエッジはワールドステートの `edges`（PeerEdge のみ）には含まれず、
 * `ContractEntity.deployerAddress` から都度導出する（OwnershipEdge が
 * `WalletEntity.ownerWorkbenchId` から導出するのと同じ設計）。
 */

export interface DeployEdgeData extends Record<string, unknown> {
  /** ポップオーバー表示用のデプロイ元アドレス（= source と同じ値）。 */
  deployerAddress: string;
  /** 現在このエッジがホバーされているか（Canvas.tsx が hover 状態から注入する）。 */
  hovered?: boolean;
}

export type DeployFlowEdge = Edge<DeployEdgeData>;

/** React Flow の edgeTypes で使うデプロイエッジの型名。 */
export const DEPLOY_EDGE_TYPE = "deploy";

/**
 * キャンバスの合併エッジ型からデプロイエッジだけを絞り込むための型ガード
 * （peerEdge.ts の isPeerFlowEdge と同じ狙い。Canvas.tsx のホバー処理で使う）。
 */
export function isDeployFlowEdge(edge: Edge): edge is DeployFlowEdge {
  return edge.type === DEPLOY_EDGE_TYPE;
}

/**
 * コントラクト群からデプロイエッジ（ウォレット → コントラクト）を導出する。
 *
 * - `deployerAddress` が省略されているコントラクト（デプロイを観測できな
 *   かった。手動デプロイや追跡外アドレスからのデプロイ含む）はエッジを
 *   作らない。
 * - デプロイ元のウォレットが現在キャンバス上に存在しない場合も作らない
 *   （ダングリング参照ガード。ARCHITECTURE.md §6.3）。
 * - source = ウォレットの address、target = コントラクトの address。
 */
export function deployEdgesToFlowEdges(
  contracts: ContractEntity[],
  presentWalletIds: Iterable<string>,
): DeployFlowEdge[] {
  const present =
    presentWalletIds instanceof Set
      ? presentWalletIds
      : new Set<string>(presentWalletIds);
  const result: DeployFlowEdge[] = [];

  for (const contract of contracts) {
    const deployer = contract.deployerAddress;
    if (!deployer) continue;
    if (!present.has(deployer)) continue;

    result.push({
      id: `deploy-${deployer}-${contract.address}`,
      type: DEPLOY_EDGE_TYPE,
      source: deployer,
      target: contract.address,
      className: "deploy-edge",
      data: { deployerAddress: deployer },
    });
  }

  return result;
}
