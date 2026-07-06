import type { PeerEdge } from "@chainviz/shared";
import type { Edge } from "@xyflow/react";
import type { MessageKey } from "../i18n/messages.js";

/**
 * B層のピア接続（紐）を React Flow のエッジに変換するための型・関数。
 *
 * `PeerEdge.fromNodeId` / `toNodeId` はインフラエンティティの安定 ID
 * （= React Flow ノードの `id`）に対応する。エッジはこの ID で
 * ノードカードに接続する。
 */

/**
 * エッジ上を1回走るパルス（光の点）1つ分の描画データ。
 * タイミング計算（どちらの端点から出発するか・何ミリ秒かけて渡るか）は
 * `blockPulse.ts` の純粋関数が実データから算出する。ここはその結果を
 * React Flow のカスタムエッジへ渡すための入れ物。
 */
export interface EdgePulse extends Record<string, unknown> {
  /** この描画インスタンスを一意に識別するキー（同じエッジ上の重複描画を区別）。 */
  key: string;
  /**
   * パルスの進行方向。エッジは端点を `[小, 大]`（source=小, target=大）に
   * 正規化しているため、実データ上の伝播が「大→小」の向きなら `true`。
   */
  reverse: boolean;
  /** パルスがエッジを渡り切るのにかける時間（ms）。 */
  durationMs: number;
}

export interface PeerEdgeData extends Record<string, unknown> {
  /** どの P2P ネットワークに属する接続か。将来の複数チェーン比較で使う。 */
  networkId: string;
  /** このエッジ上で現在走らせるブロック伝播パルス（無ければ未設定）。 */
  pulses?: EdgePulse[];
  /**
   * ホバーポップオーバー（Issue #124）に出す端点表記。stableId
   * （`${project}/${service}` 形式。collector 側 `stableId` 参照）の
   * service 部分を `[小, 大]` の順（source, target と対応）で持つ。
   * optional なのは、防御的にエッジを組み立てる経路（`blockPulse.ts` の
   * フォールバック等）が省略できるようにするため。省略時は表示側が空表記に
   * フォールバックする。
   */
  endpoints?: [string, string];
  /** 現在このエッジがホバーされているか（Canvas.tsx が hover 状態から注入する）。 */
  hovered?: boolean;
}

export type PeerFlowEdge = Edge<PeerEdgeData>;

/** ブロック伝播パルスを描くカスタムエッジの型名（React Flow の edgeTypes キー）。 */
export const PEER_EDGE_TYPE = "peer";

/**
 * キャンバスの合併エッジ型（`CanvasFlowEdge`）からピア接続だけを絞り込む
 * ための型ガード。B/C層のエッジはいずれも `Edge<T>`（2 引数）で `type` が
 * リテラル型ではないため、TypeScript は `edge.type === PEER_EDGE_TYPE` の
 * 比較だけでは型を絞り込めない。Canvas.tsx のホバー処理・凡例向けの
 * フィルタで共有する（Issue #124）。
 */
export function isPeerFlowEdge(edge: Edge): edge is PeerFlowEdge {
  return edge.type === PEER_EDGE_TYPE;
}

/**
 * networkId ごとに紐の色を分けるためのパレット。
 * Ethereum プロファイル単体でも execution・consensus という2種類の
 * networkId を持つ（Issue #106 以降。`targets.ts` の
 * consensusNetworkId/executionNetworkId 参照）ため、最低でも2色を区別できる
 * 必要がある。加えて将来の複数チェーン比較（Phase 6 以降）でもネットワークを
 * 見分けられるようにしておく。
 *
 * 紐は `stroke-opacity` を掛けた状態で背景色(--bg #0f1420)の上に描かれるため、
 * 見た目のコントラストは単色のコントラスト比だけでは測れない。背景と混色した
 * 実効色で比較したところ、青・紫は背景の紺色に近い色相のため埋もれやすく
 * （混色後コントラスト比が約3.9:1）、他の4色より見づらかった。そのため
 * 青・紫のみ明度を上げている（緑・橙・水色は混色後も5:1以上あり変更なし）。
 * Issue #32。
 *
 * このパレットには C層の所有エッジ（`styles.css` の `--own-edge: #e0a94f`、
 * 琥珀）・操作エッジ（`--op-edge: #ff5db1`、マゼンタ）と紛らわしい色を
 * 含めない。以前はこの配列に琥珀寄りの `#f5b544` が含まれており、
 * networkId のハッシュ次第では所有エッジの `#e0a94f` とほぼ同じ色相
 * （Lab色空間でのΔE ≈ 12、視認上は線種でしか区別できない近さ）になって
 * いた。実際に検証環境（networkId "1337"）でこの組み合わせが再現した
 * ため、`#f5b544` を黄緑系の `#c8e04a` に差し替えた（所有エッジとの
 * ΔE ≈ 43、既存の緑 `#38d39f` とのΔE ≈ 59 で、どちらとも明確に見分けが
 * つく）。Issue #95。
 */
export const NETWORK_COLORS: readonly string[] = [
  "#7db8ff",
  "#38d39f",
  "#c8e04a",
  "#d59bff",
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
 * stableId（collector が付与するエンティティ id。`${project}/${service}`
 * 形式。`profiles/ethereum` の compose service 名を含む）から、ホバー
 * ポップオーバーで人が読める短い表記（service 部分）を取り出す
 * （Issue #124）。`/` を含まない stableId（旧形式・別チェーン想定）は
 * そのまま返す。
 */
export function stableIdServiceName(stableId: string): string {
  const idx = stableId.lastIndexOf("/");
  return idx === -1 ? stableId : stableId.slice(idx + 1);
}

/**
 * networkId から「これが何のP2Pネットワークか」の表示情報を導く
 * （ネットワーク凡例・ピアエッジのホバーポップオーバーで共有。Issue #124）。
 *
 * networkId 末尾の `-execution` / `-consensus` は Ethereum の ChainAdapter
 * （`packages/collector/src/adapters/ethereum/targets.ts` の
 * consensusNetworkId/executionNetworkId）が付ける接尾辞であり、Ethereum
 * プロファイルのフロント表現セットの一部。将来別チェーンプロファイルを
 * 追加するときは、この関数を差し替え単位として新しい判定を足す
 * （既存の分岐に手を入れて増やす方向にはしない。CLAUDE.md「チェーン
 * プロファイル単位で増やす」）。どちらにも合致しない networkId は
 * 用語解説の無い生の networkId 表示にフォールバックする。
 */
export type NetworkNameInfo =
  | { kind: "known"; labelKey: MessageKey; termKey: "execution-p2p" | "consensus-p2p" }
  | { kind: "raw" };

export function describeNetwork(networkId: string): NetworkNameInfo {
  if (networkId.endsWith("-execution")) {
    return { kind: "known", labelKey: "network.execution", termKey: "execution-p2p" };
  }
  if (networkId.endsWith("-consensus")) {
    return { kind: "known", labelKey: "network.consensus", termKey: "consensus-p2p" };
  }
  return { kind: "raw" };
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
      type: PEER_EDGE_TYPE,
      source: lo,
      target: hi,
      data: {
        networkId: edge.networkId,
        endpoints: [stableIdServiceName(lo), stableIdServiceName(hi)],
      },
      className: `peer-edge peer-edge--net-${networkClassToken(edge.networkId)}`,
      // strokeWidth は初期値(1.5)だと細く、opacity 併用時に背景へ埋もれ
      // やすかったため 2 に太くした（Issue #32）。
      style: { stroke: color, strokeWidth: 2 },
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
