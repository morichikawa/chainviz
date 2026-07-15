import {
  CHAIN_RIBBON_NODE_TYPE,
  type ChainRibbonFlowNode,
} from "./chainRibbonNode.js";
import type { ConnectingFlowEdge } from "./connectingEdge.js";
import type { ContractCallPulseFlowEdge } from "./contractCallPulseEdge.js";
import type { ContractFlowNode } from "./contractNode.js";
import type { DeployFlowEdge } from "./deployEdge.js";
import { GHOST_NODE_TYPE, type GhostFlowNode } from "./ghostNode.js";
import type { InfraFlowNode } from "./infraNode.js";
import type { InternalLinkFlowEdge } from "./internalLinkEdge.js";
import type { OperationFlowEdge } from "./operationEdge.js";
import type { OperationTargetFlowEdge } from "./operationTargetEdge.js";
import type { OwnershipFlowEdge } from "./ownershipEdge.js";
import type { PeerFlowEdge } from "./peerEdge.js";
import type { PendingConnectionFlowEdge } from "./pendingConnectionEdge.js";
import type { WalletFlowNode } from "./walletNode.js";

/**
 * キャンバスに載る全カード種別（A層のインフラカード + C層のウォレットカード +
 * C層拡張のコントラクトカード + 追加コマンド送信直後の仮カード）と全エッジ
 * 種別（B層のピア接続 + C層の所有エッジ + C層拡張のデプロイエッジ +
 * ワークベンチ → ノードの操作エッジ + Issue #123 の予告/確立中/常設操作先
 * エッジ + C層拡張のtx確定パルスエッジ）の合併型。Canvas はこの合併型で
 * ノード/エッジを受け取り、種別ごとに nodeTypes / edgeTypes へ振り分ける。
 * D層拡張の内部リンクエッジ（`InternalLinkFlowEdge`。Issue #188）も含む。
 * チェーンリボン（`ChainRibbonFlowNode`。Issue #298）はチェーン全体で常設
 * 1本のカードで、コントラクトカードと同じくどのノードにも従属しない。
 */
export type CanvasFlowNode =
  | InfraFlowNode
  | WalletFlowNode
  | ContractFlowNode
  | GhostFlowNode
  | ChainRibbonFlowNode;

export type CanvasFlowEdge =
  | PeerFlowEdge
  | OwnershipFlowEdge
  | DeployFlowEdge
  | OperationFlowEdge
  | PendingConnectionFlowEdge
  | ConnectingFlowEdge
  | OperationTargetFlowEdge
  | ContractCallPulseFlowEdge
  | InternalLinkFlowEdge;

/**
 * ノードの位置永続化に使う安定 ID を返す。インフラカードは containerName、
 * ウォレットカード・コントラクトカードは address をキーにする（どちらも
 * Docker コンテナ ID のように再起動で変わらない安定識別子）。
 *
 * ゴーストカード（仮カード）は `draggable: false` でドラッグ自体ができないため
 * 実際にはこの分岐に到達しないが、CanvasFlowNode の合併型を網羅するために
 * commandId をキーとして返す（永続化はされない）。
 *
 * チェーンリボン（Issue #298）はエンティティを持たず、固定 id
 * （`CHAIN_RIBBON_ID`）自体が既に安定識別子なのでそのまま使う。
 */
export function canvasNodeLayoutKey(node: CanvasFlowNode): string {
  if (node.type === GHOST_NODE_TYPE) return node.data.commandId;
  if (node.type === CHAIN_RIBBON_NODE_TYPE) return node.id;
  const entity = node.data.entity;
  return entity.kind === "wallet" || entity.kind === "contract"
    ? entity.address
    : entity.containerName;
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

/**
 * ドラッグ中のノードの `position`・`dragging`・`selected` を、ワールドステート
 * 更新で親（App.tsx）が再計算した `next` ではなく、直前の React Flow 内部
 * 状態（`previous`）から引き継ぐ（Issue #328）。
 *
 * 親の `nodes` の `position` は `layout`（localStorage 由来。
 * `onNodeDragStop` でのみ更新）から組み立てられる。約2秒周期で届く
 * WebSocket 差分のたびに Canvas.tsx の useEffect が `rfNodes` を丸ごと
 * `next` へ置き換えると、ドラッグ中のカードが「ドラッグ開始前の保存位置」へ
 * 一瞬描き戻り、次の pointermove で再びカーソル位置へ動くため位置が
 * 「ガクン」と往復して見えていた。
 *
 * `@xyflow/react` はドラッグ開始・移動・終了のたびに `type: "position"` の
 * `NodeChange` に `dragging: true`(開始・移動中)/`dragging: false`(終了)を
 * 積んで `onNodesChange` 経由でディスパッチし、`applyNodeChanges` がそれを
 * そのまま `node.dragging` へ反映する。そのため Canvas.tsx の `rfNodes`
 * （＝この関数の `previous`）は常に「今どのノードがドラッグ中か」を正しく
 * 保持しており、`onNodeDragStart`/`onNodeDragStop` で id を別途追跡しなくても
 * `previous` 側の `dragging` フラグだけで判定できる（`selected` も
 * select/unselect change を通じて同様に反映される）。
 *
 * マージするのは見た目・操作状態に関わる3フィールドのみで、`data` は常に
 * `next`（最新の WorldState 由来）を優先する。ドラッグ中でも残高やブロック高
 * などのカード内容は従来どおり更新され続けるべきで、止めたいのは位置周りの
 * ちらつきだけのため。ドラッグ中でないノードには一切手を加えないため、他
 * ノードの追加・移動などの WebSocket 更新は従来どおり即座に反映され続ける。
 */
export function preserveDraggingState<TNode extends CanvasFlowNode>(
  next: TNode[],
  previous: TNode[],
): TNode[] {
  if (previous.length === 0) return next;

  const draggingById = new Map(
    previous.filter((node) => node.dragging === true).map((node) => [node.id, node]),
  );
  if (draggingById.size === 0) return next;

  return next.map((node) => {
    const draggingNode = draggingById.get(node.id);
    if (!draggingNode) return node;
    return {
      ...node,
      position: draggingNode.position,
      dragging: draggingNode.dragging,
      selected: draggingNode.selected,
    };
  });
}
