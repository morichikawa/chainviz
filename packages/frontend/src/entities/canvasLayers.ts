import { CONTRACT_CALL_PULSE_EDGE_TYPE } from "./contractCallPulseEdge.js";
import { CONTRACT_NODE_TYPE } from "./contractNode.js";
import { DEPLOY_EDGE_TYPE } from "./deployEdge.js";
import { INTERNAL_LINK_EDGE_TYPE } from "./internalLinkEdge.js";
import { OPERATION_EDGE_TYPE } from "./operationEdge.js";
import { OPERATION_TARGET_EDGE_TYPE } from "./operationTargetEdge.js";
import { OWNERSHIP_EDGE_TYPE } from "./ownershipEdge.js";
import { PEER_EDGE_TYPE } from "./peerEdge.js";
import { WALLET_NODE_TYPE } from "./walletNode.js";
import type { CanvasFlowEdge, CanvasFlowNode } from "./canvasNode.js";

/**
 * 「レイヤーレンズ」(Issue #299)。A〜D層が常時同一キャンバスに共存し情報が
 * 読み取りにくいという課題への対応で、既定は全層通常表示のまま、レイヤーを
 * 1つ選ぶとその層以外の要素を薄く(dim)表示する。UX設計の判定表は
 * docs/worklog/issue-299.md §3.2 参照。
 *
 * 非表示にする切り替えではなく「薄くする」方式なので、対象の要素が
 * キャンバスから消えることはない(ホバー・ポップオーバーは薄い状態でも
 * 機能する。dim の反映方法は Canvas.tsx 側で `className` に
 * `LAYER_LENS_DIM_CLASS` を足すだけにし、対応する CSS の `:hover` で
 * 一時的に通常表示へ戻す。styles.css 参照)。
 */
export type VisualizationLayer = "a" | "b" | "c" | "d";

/** チップバーの選択値。"all" は既定(絞り込み無し)。 */
export type LayerFilter = "all" | VisualizationLayer;

/** dim 対象に付ける修飾クラス名(styles.css と対応)。 */
export const LAYER_LENS_DIM_CLASS = "layer-lens-dim";

/**
 * React Flow の `nodeTypes` に登録しているインフラカードの型名。
 * `entities/infraNode.ts` はこの値を文字列リテラルのまま使っており
 * (`WALLET_NODE_TYPE`/`CONTRACT_NODE_TYPE` と違って専用の export 定数を
 * 持たない)、ここでも同じリテラルで揃える。
 */
const INFRA_NODE_TYPE = "infra";

/**
 * エッジ種別(React Flow の `edgeTypes` キー)からその層への対応表
 * (UX設計 §3.2 の判定表そのもの)。`pendingConnection`/`connecting`
 * (ゴースト由来の接続予定・接続確立中エッジ)はここに含めない。含めない
 * ことで「層を持たない」= 常に dim 対象にも「選択層のエッジ」にもならない
 * 扱いになり、Issue #102/#220 で潰した操作フィードバックの視認性事故を
 * レンズが再発させない(docs/worklog/issue-299.md §3.3)。
 */
const EDGE_LAYER_BY_TYPE: Readonly<Record<string, VisualizationLayer>> = {
  [PEER_EDGE_TYPE]: "b",
  [OWNERSHIP_EDGE_TYPE]: "c",
  [DEPLOY_EDGE_TYPE]: "c",
  [OPERATION_EDGE_TYPE]: "c",
  [OPERATION_TARGET_EDGE_TYPE]: "c",
  [CONTRACT_CALL_PULSE_EDGE_TYPE]: "c",
  [INTERNAL_LINK_EDGE_TYPE]: "d",
};

/** このエッジが属する層。対応表に無い型(ゴースト付随エッジ等)は `undefined`。 */
export function edgeVisualizationLayer(
  edge: Pick<CanvasFlowEdge, "type">,
): VisualizationLayer | undefined {
  if (edge.type === undefined) return undefined;
  return EDGE_LAYER_BY_TYPE[edge.type];
}

/**
 * カード自体の既定層。ウォレット/コントラクトは常に C層、インフラ
 * (node/workbench)は既定 A層(B/C/D層のエッジの端点になっていれば
 * その層でも通常表示になる。`computeLayerVisibility` 参照)。ゴーストカード
 * (仮カード)は操作フィードバックのためレンズ対象外(`undefined`)。
 */
function baseCardLayer(node: CanvasFlowNode): VisualizationLayer | undefined {
  if (node.type === WALLET_NODE_TYPE || node.type === CONTRACT_NODE_TYPE) {
    return "c";
  }
  if (node.type === INFRA_NODE_TYPE) return "a";
  return undefined; // ghost 等
}

/**
 * 実カード到着からの新着発光中(Issue #123 UX設計)かどうか。infra/contract の
 * データ型だけが持つ任意フィールドだが、`CanvasFlowNode` の合併型はいずれも
 * `Record<string, unknown>` を継承しているため、存在しない型でも安全に読める。
 */
function isNewArrivalNode(node: CanvasFlowNode): boolean {
  return (node.data as { isNew?: boolean }).isNew === true;
}

export interface LayerVisibility {
  /** dim 対象にするノード id の集合。"all" 選択時は常に空集合。 */
  dimNodeIds: ReadonlySet<string>;
  /** dim 対象にするエッジ id の集合。"all" 選択時は常に空集合。 */
  dimEdgeIds: ReadonlySet<string>;
}

const EMPTY_VISIBILITY: LayerVisibility = {
  dimNodeIds: new Set(),
  dimEdgeIds: new Set(),
};

/**
 * 現在のキャンバス上のノード・エッジと選択中のレイヤーから、dim 対象の
 * id 集合を求める(純粋関数)。判定順序:
 *
 * 1. 選択層に属するエッジ(`edgeVisualizationLayer` が選択層と一致)は
 *    通常表示のまま。それ以外のレイヤーを持つエッジは dim 対象にする
 *    (層を持たない = レンズ対象外のエッジは常に通常表示)
 * 2. 通常表示のままのエッジの端点ノードは通常表示にする
 *    (UX設計 §3.2「選択層のエッジの端点カードは通常表示」ルール)
 * 3. カード自身の既定層(`baseCardLayer`)が選択層と一致するカードも
 *    常に通常表示(A層レンズでのインフラカード全件、C層レンズでの
 *    ウォレット/コントラクトカード全件)
 * 4. 新着発光中のカード・レイヤーを持たないカード(ゴースト)は
 *    dim 対象にしない
 */
export function computeLayerVisibility(
  nodes: readonly CanvasFlowNode[],
  edges: readonly CanvasFlowEdge[],
  filter: LayerFilter,
): LayerVisibility {
  if (filter === "all") return EMPTY_VISIBILITY;

  const dimEdgeIds = new Set<string>();
  const normalEndpointIds = new Set<string>();
  for (const edge of edges) {
    const layer = edgeVisualizationLayer(edge);
    if (layer === undefined) continue; // レンズ対象外(常に通常表示)
    if (layer === filter) {
      normalEndpointIds.add(edge.source);
      normalEndpointIds.add(edge.target);
    } else {
      dimEdgeIds.add(edge.id);
    }
  }

  const dimNodeIds = new Set<string>();
  for (const node of nodes) {
    const layer = baseCardLayer(node);
    if (layer === undefined) continue; // レンズ対象外(ゴースト等)
    if (layer === filter) continue; // 自層のカードは常に通常表示
    if (normalEndpointIds.has(node.id)) continue; // 選択層のエッジの端点
    if (isNewArrivalNode(node)) continue; // 新着発光中はレンズ対象外
    dimNodeIds.add(node.id);
  }

  return { dimNodeIds, dimEdgeIds };
}

/**
 * `className` へ `LAYER_LENS_DIM_CLASS` を過不足なく足し引きした結果を返す
 * (Canvas.tsx の displayNodes/displayEdges 注入で使う)。既に望む状態なら
 * 同じ文字列参照を返し、無関係な再レンダーを避ける(hover 注入と同じ流儀)。
 */
export function withLayerDimClassName(
  className: string | undefined,
  dim: boolean,
): string | undefined {
  const tokens = className ? className.split(" ").filter(Boolean) : [];
  const hasDim = tokens.includes(LAYER_LENS_DIM_CLASS);
  if (dim === hasDim) return className;

  if (dim) {
    return [...tokens, LAYER_LENS_DIM_CLASS].join(" ");
  }
  const next = tokens.filter((token) => token !== LAYER_LENS_DIM_CLASS).join(" ");
  return next.length > 0 ? next : undefined;
}
