import type { InternalCallStats, NodeEntity, NodeLinkActivity } from "@chainviz/shared";
import type { Edge } from "@xyflow/react";

/**
 * D層: 内部リンクエッジ（`NodeEntity.drivesNodeId` から導出する beacon(CL) →
 * reth(EL) の常設エッジ。ARCHITECTURE.md §7.6.3）。
 *
 * `deployEdge.ts`（`ContractEntity.deployerAddress` から常設エッジを導出する
 * パターン）と同じ考え方だが、揮発性の活動パルス（`NodeLinkActivity`）を
 * 永続エッジの上に乗せる点は `blockPulse.ts`（ピア接続 + ブロック伝播パルス）
 * に近い。パルスそのものの生成・タイマー管理は `useNodeLinkActivityPulses.ts`
 * が担い、ここは純粋なデータ変換だけを持つ（テスト容易性のため）。
 */

/** React Flow の edgeTypes で使う内部リンクエッジの型名。 */
export const INTERNAL_LINK_EDGE_TYPE = "internalLink";

/**
 * ノード内部の観測（reth の `/metrics` ポーリング）間隔（ms）。collector 側
 * `packages/collector/src/adapters/ethereum/reth-metrics-tracker.ts` の
 * `NODE_INTERNALS_POLL_INTERVAL_MS` と同じ値であることが前提。frontend は
 * collector パッケージに依存できない（CLAUDE.md の一方向依存の境界）ため
 * 値をコピーして持っており、**collector 側の値を変更したらこちらも合わせる
 * こと**。ポップオーバーの「直近{N}秒の呼び出し」という表示文言（1回の
 * `NodeLinkActivity` 観測が指す時間幅）にのみ使う。
 */
export const INTERNAL_LINK_POLL_INTERVAL_MS = 3000;

/**
 * 「観測が途絶えた」と判断するまでの鮮度ウィンドウ（ms）。ARCHITECTURE.md
 * §7.6.3「最終観測から10秒（スクレイプ間隔3秒の3回分+余裕。観測が途絶えたと
 * 判断できる長さ）を過ぎたら『最近の呼び出しはありません』に切り替える」を
 * そのまま計算式にする。10000 を直接埋め込まず `INTERNAL_LINK_POLL_INTERVAL_MS`
 * からの導出にすることで、ポーリング間隔を変更したときに鮮度判定が追従する
 * （品質ゲート運用ルール: 固定値は前提条件込みで明記する）。
 */
export const INTERNAL_LINK_FRESHNESS_MS = INTERNAL_LINK_POLL_INTERVAL_MS * 3 + 1000;

/** パルスがエッジを渡り切る時間（ms）。既存のパルス演出と同程度にする。 */
export const INTERNAL_LINK_PULSE_DURATION_MS = 900;

/** 内部リンクエッジの色（styles.css の `--internal-edge` と一致させること）。 */
export const INTERNAL_LINK_EDGE_COLOR = "var(--internal-edge)";

/** 二重線のうち外側の「鞘」の太さ・不透明度（styles.css と対応）。 */
export const INTERNAL_LINK_SHEATH_WIDTH = 6;
export const INTERNAL_LINK_SHEATH_WIDTH_HOVERED = 8;
export const INTERNAL_LINK_SHEATH_OPACITY = 0.18;

/** 二重線のうち内側の「芯」の太さ・不透明度（styles.css と対応）。 */
export const INTERNAL_LINK_CORE_WIDTH = 1.5;
export const INTERNAL_LINK_CORE_WIDTH_HOVERED = 2.4;
export const INTERNAL_LINK_CORE_OPACITY = 0.8;

/** エッジ上を1本走る活動パルス1つ分の描画データ。 */
export interface InternalLinkPulse extends Record<string, unknown> {
  /** この描画インスタンスを一意に識別するキー。 */
  key: string;
  durationMs: number;
}

/** ポップオーバーへ出す「このエッジの直近観測」。 */
export interface InternalLinkActivitySummary {
  calls: InternalCallStats[];
  observedAt: number;
}

export interface InternalLinkEdgeData extends Record<string, unknown> {
  /** ポップオーバー端点表記用: 駆動する側（CL）の containerName。 */
  drivingContainerName: string;
  /** ポップオーバー端点表記用: 駆動される側（EL）の containerName。 */
  drivenContainerName: string;
  /** 現在このエッジがホバーされているか（Canvas.tsx が hover 状態から注入する）。 */
  hovered?: boolean;
  /** このエッジ上で現在走らせている活動パルス。 */
  pulses?: InternalLinkPulse[];
  /** このエッジの直近観測（ポップオーバー表示用。未観測なら省略）。 */
  lastActivity?: InternalLinkActivitySummary;
}

export type InternalLinkFlowEdge = Edge<InternalLinkEdgeData>;

/**
 * WebSocket から届いた揮発性の `nodeLinkActivity` イベントに、フロント側で
 * 採番した通し番号を付けたもの（`OperationSignal` と同型）。
 * `useNodeLinkActivityPulses` は seq をキーに未処理分だけを消費する。
 */
export interface NodeLinkActivitySignal {
  /** フロント側で単調増加する通し番号（重複排除キー）。 */
  seq: number;
  activity: NodeLinkActivity;
}

/**
 * キャンバスの合併エッジ型から内部リンクエッジだけを絞り込む型ガード
 * （`isPeerFlowEdge`/`isDeployFlowEdge` と同じ狙い。Canvas.tsx のホバー処理で使う）。
 */
export function isInternalLinkFlowEdge(edge: Edge): edge is InternalLinkFlowEdge {
  return edge.type === INTERNAL_LINK_EDGE_TYPE;
}

/** 駆動元・駆動先ノードのペアから、内部リンクエッジの安定 ID を作る。 */
export function internalLinkEdgeId(fromNodeId: string, toNodeId: string): string {
  return `internal-link-${fromNodeId}=>${toNodeId}`;
}

/**
 * ノード群から内部リンクエッジ（常設。パルス・直近観測なしの土台）を導出する。
 *
 * - `drivesNodeId` を持つノード（CL）だけが起点になる。
 * - 自己参照・自身が現在キャンバス上に無い・駆動先が現在キャンバス上に無い
 *   （削除された、または解決できなかった）場合は描かない（§7.4 ダングリング
 *   ガード。`deployEdgesToFlowEdges` と同じ考え方）。
 * - source = 駆動する側（CL）、target = 駆動される側（EL）で固定する。
 *   活動パルスは常にこの方向（CL→EL）に流すため、`PeerFlowEdge` のような
 *   `reverse` フラグは不要（ARCHITECTURE.md §7.6.4「進行方向は CL→EL 固定」）。
 */
export function internalLinkEdgesToFlowEdges(
  nodes: NodeEntity[],
  presentNodeIds: Iterable<string>,
): InternalLinkFlowEdge[] {
  const present =
    presentNodeIds instanceof Set ? presentNodeIds : new Set<string>(presentNodeIds);
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const result: InternalLinkFlowEdge[] = [];

  for (const node of nodes) {
    const drivenId = node.drivesNodeId;
    if (!drivenId) continue;
    if (drivenId === node.id) continue; // 自己ループは描かない
    if (!present.has(node.id) || !present.has(drivenId)) continue;
    const driven = nodesById.get(drivenId);
    if (!driven) continue; // 解決できない（ノード一覧に無い）駆動先は描かない

    result.push({
      id: internalLinkEdgeId(node.id, drivenId),
      type: INTERNAL_LINK_EDGE_TYPE,
      source: node.id,
      target: drivenId,
      data: {
        drivingContainerName: node.containerName,
        drivenContainerName: driven.containerName,
      },
      className: "internal-link-edge",
      style: {
        stroke: INTERNAL_LINK_EDGE_COLOR,
        strokeWidth: INTERNAL_LINK_SHEATH_WIDTH,
        strokeOpacity: INTERNAL_LINK_SHEATH_OPACITY,
      },
    });
  }

  return result;
}

/**
 * 描画中のパルス・直近観測を常設エッジ配列へ合成した新しい配列を返す（純粋
 * 関数。`blockPulse.ts` の `attachPulsesToEdges` と同じ狙い・同じ慣習）。
 * 変化の無いエッジは参照を保つ（無関係な再レンダーを避ける）。パルスが
 * 尽きたエッジの `data.pulses` は空配列ではなく `undefined` にする
 * （`attachPulsesToEdges` と同じ「無い」の表現。描画側は `data?.pulses ?? []`
 * で受けるため実害は無い）。
 */
export function attachInternalLinkActivity(
  edges: InternalLinkFlowEdge[],
  pulsesByEdgeId: ReadonlyMap<string, InternalLinkPulse[]>,
  lastActivityByEdgeId: ReadonlyMap<string, InternalLinkActivitySummary>,
): InternalLinkFlowEdge[] {
  return edges.map((edge) => {
    const pulses = pulsesByEdgeId.get(edge.id);
    const lastActivity = lastActivityByEdgeId.get(edge.id);
    const hadPulses = (edge.data?.pulses?.length ?? 0) > 0;
    const hadActivity = edge.data?.lastActivity !== undefined;
    if (!pulses && !hadPulses && lastActivity === undefined && !hadActivity) {
      return edge;
    }
    return {
      ...edge,
      data: { ...edge.data, pulses, lastActivity },
    } as InternalLinkFlowEdge;
  });
}
