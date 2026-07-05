import type { InfraFlowNode } from "./infraNode.js";
import type { OwnershipFlowEdge } from "./ownershipEdge.js";
import type { PeerFlowEdge } from "./peerEdge.js";
import type { WalletFlowNode } from "./walletNode.js";

/**
 * キャンバスに載る全カード種別（A層のインフラカード + C層のウォレットカード）と
 * 全エッジ種別（B層のピア接続 + C層の所有エッジ）の合併型。Canvas はこの合併型で
 * ノード/エッジを受け取り、種別ごとに nodeTypes / edgeTypes へ振り分ける。
 */
export type CanvasFlowNode = InfraFlowNode | WalletFlowNode;

export type CanvasFlowEdge = PeerFlowEdge | OwnershipFlowEdge;

/**
 * ノードの位置永続化に使う安定 ID を返す。インフラカードは containerName、
 * ウォレットカードは address をキーにする（どちらも Docker コンテナ ID のように
 * 再起動で変わらない安定識別子）。
 */
export function canvasNodeLayoutKey(node: CanvasFlowNode): string {
  const entity = node.data.entity;
  return entity.kind === "wallet" ? entity.address : entity.containerName;
}
