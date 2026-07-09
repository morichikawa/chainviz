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
 *
 * 端点の一致判定は大文字小文字を無視する。`ContractEntity.deployerAddress`
 * は tx の receipt（`from`）由来でチェーン側の生の表記（Ethereum アダプタでは
 * 全小文字）になる一方、`presentWalletIds`（`WalletEntity.address`）は
 * mnemonic から viem で導出した EIP-55 チェックサム表記になりうる
 * （`wallet-derivation.ts` 参照）。単純な文字列一致では常に不一致となり、
 * 実際にデプロイされたコントラクトでもデプロイエッジが一切描画されない
 * 不具合を実機（Issue #201 の E2E 実装）で確認したため、大文字小文字を
 * 無視して照合したうえで、実際にキャンバス上に存在するウォレットの表記
 * （React Flow のノード id と一致する表記）を edge の端点として使う
 * （表記がずれたままだと React Flow がノードを解決できずエッジを描画
 * できないため、`present` 側の元の表記を採用する）。
 */
export function deployEdgesToFlowEdges(
  contracts: ContractEntity[],
  presentWalletIds: Iterable<string>,
): DeployFlowEdge[] {
  const presentByLowerCase = new Map<string, string>();
  for (const id of presentWalletIds) presentByLowerCase.set(id.toLowerCase(), id);
  const result: DeployFlowEdge[] = [];

  for (const contract of contracts) {
    const deployer = contract.deployerAddress;
    if (!deployer) continue;
    const resolvedDeployerId = presentByLowerCase.get(deployer.toLowerCase());
    if (!resolvedDeployerId) continue;

    result.push({
      id: `deploy-${resolvedDeployerId}-${contract.address}`,
      type: DEPLOY_EDGE_TYPE,
      source: resolvedDeployerId,
      target: contract.address,
      className: "deploy-edge",
      data: { deployerAddress: resolvedDeployerId },
    });
  }

  return result;
}
