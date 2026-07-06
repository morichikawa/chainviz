import { GHOST_NODE_TYPE, type GhostFlowNode } from "./ghostNode.js";
import type { InfraFlowNode } from "./infraNode.js";
import type { OperationFlowEdge } from "./operationEdge.js";
import type { OwnershipFlowEdge } from "./ownershipEdge.js";
import type { PeerFlowEdge } from "./peerEdge.js";
import type { WalletFlowNode } from "./walletNode.js";

/**
 * キャンバスに載る全カード種別（A層のインフラカード + C層のウォレットカード +
 * 追加コマンド送信直後の仮カード）と全エッジ種別（B層のピア接続 + C層の所有
 * エッジ + ワークベンチ → ノードの操作エッジ）の合併型。Canvas はこの合併型で
 * ノード/エッジを受け取り、種別ごとに nodeTypes / edgeTypes へ振り分ける。
 */
export type CanvasFlowNode = InfraFlowNode | WalletFlowNode | GhostFlowNode;

export type CanvasFlowEdge =
  | PeerFlowEdge
  | OwnershipFlowEdge
  | OperationFlowEdge;

/**
 * ノードの位置永続化に使う安定 ID を返す。インフラカードは containerName、
 * ウォレットカードは address をキーにする（どちらも Docker コンテナ ID のように
 * 再起動で変わらない安定識別子）。
 *
 * ゴーストカード（仮カード）は `draggable: false` でドラッグ自体ができないため
 * 実際にはこの分岐に到達しないが、CanvasFlowNode の合併型を網羅するために
 * commandId をキーとして返す（永続化はされない）。
 */
export function canvasNodeLayoutKey(node: CanvasFlowNode): string {
  if (node.type === GHOST_NODE_TYPE) return node.data.commandId;
  const entity = node.data.entity;
  return entity.kind === "wallet" ? entity.address : entity.containerName;
}
