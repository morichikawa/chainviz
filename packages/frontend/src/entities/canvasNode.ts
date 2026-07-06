import type { ConnectingFlowEdge } from "./connectingEdge.js";
import { GHOST_NODE_TYPE, type GhostFlowNode } from "./ghostNode.js";
import type { InfraFlowNode } from "./infraNode.js";
import type { OperationFlowEdge } from "./operationEdge.js";
import type { OperationTargetFlowEdge } from "./operationTargetEdge.js";
import type { OwnershipFlowEdge } from "./ownershipEdge.js";
import type { PeerFlowEdge } from "./peerEdge.js";
import type { PendingConnectionFlowEdge } from "./pendingConnectionEdge.js";
import type { WalletFlowNode } from "./walletNode.js";

/**
 * キャンバスに載る全カード種別（A層のインフラカード + C層のウォレットカード +
 * 追加コマンド送信直後の仮カード）と全エッジ種別（B層のピア接続 + C層の所有
 * エッジ + ワークベンチ → ノードの操作エッジ + Issue #123 の予告/確立中/常設
 * 操作先エッジ）の合併型。Canvas はこの合併型でノード/エッジを受け取り、
 * 種別ごとに nodeTypes / edgeTypes へ振り分ける。
 */
export type CanvasFlowNode = InfraFlowNode | WalletFlowNode | GhostFlowNode;

export type CanvasFlowEdge =
  | PeerFlowEdge
  | OwnershipFlowEdge
  | OperationFlowEdge
  | PendingConnectionFlowEdge
  | ConnectingFlowEdge
  | OperationTargetFlowEdge;

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

/**
 * ワールドステート更新のたびに親（App.tsx）が組み立てる `nodes` は、React Flow
 * が実測した `measured`(width/height)を持たない。React Flow は「渡された
 * ノードオブジェクトの参照が前回と同じか」で `measured` を引き継げるかを判定
 * しており、参照が変わると `measured` を破棄していったん再計測する
 * (この間、対象カードは一瞬 visibility: hidden になる。Issue #119)。
 *
 * カードの内容が変わっただけで見た目のサイズまで変わることは通常なく、
 * 毎回の再計測は不要なちらつきにしかならない。そこで、React Flow が
 * 直前に計測して `previous`(Canvas 側の内部状態)へ書き戻した `measured` を
 * `next`(親から渡された最新のノード配列)へ id ベースで引き継ぐことで、
 * ノードオブジェクトの参照が変わった場合でも再計測サイクルに入らないようにする。
 *
 * `next` 側に既に `measured` が入っている(将来 App 側が持たせるようになった)
 * 場合はそちらを優先する。`previous` に対応する id が無い(新規ノード)場合は
 * 何も付与せず、React Flow の通常の初回計測に任せる。
 */
export function preserveMeasuredDimensions<TNode extends CanvasFlowNode>(
  next: TNode[],
  previous: TNode[],
): TNode[] {
  if (previous.length === 0) return next;

  const measuredById = new Map(
    previous
      .filter((node) => node.measured?.width !== undefined && node.measured?.height !== undefined)
      .map((node) => [node.id, node.measured]),
  );
  if (measuredById.size === 0) return next;

  return next.map((node) => {
    if (node.measured?.width !== undefined && node.measured?.height !== undefined) {
      return node;
    }
    const measured = measuredById.get(node.id);
    return measured ? { ...node, measured } : node;
  });
}
