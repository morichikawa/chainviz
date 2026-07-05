import type { OperationEdge } from "@chainviz/shared";
import type { Edge } from "@xyflow/react";

/**
 * ワークベンチ → ノードの 1 回の RPC 呼び出し（操作）を、キャンバス上に一瞬だけ
 * 走るエッジ + パルスとして描画するための型・純粋関数。
 *
 * B層のピア接続（PeerEdge）やC層の所有エッジ（OwnershipEdge）と違い、操作エッジは
 * ワールドステートに保存されない「観測された瞬間の出来事」（揮発性の
 * OperationEdge / DiffEvent operationObserved）。そのためエッジ自体も永続せず、
 * パルスが流れている間だけ一時的に存在し、走り終わると消える。タイミング管理
 * （実時間へのスケジューリング・後片付け）は `useOperationPulses` が持ち、ここは
 * イベント → React Flow エッジへのデータ変換だけを担う（テスト容易性のため）。
 *
 * CONCEPT.md「操作がエッジになる」: ワークベンチからノードへの JSON-RPC 呼び出しを
 * エッジ + パルスで描く。ブロック伝播パルス（peer）と色・見た目で区別する。
 */

/** React Flow の edgeTypes で使う操作エッジの型名。 */
export const OPERATION_EDGE_TYPE = "operation";

/**
 * 操作パルスがエッジを渡り切るのにかける時間（ms）。ブロック伝播パルスと違い、
 * 操作は 1 回きりの呼び出しで実データ上の伝播時間差を持たないため、実差分から
 * 導出せず視認できる固定表示時間を用いる。この値は「操作が起きたことを一瞬
 * 目視できる最低表示時間」という UX 上の演出値であり、実測から導く量ではない。
 */
export const OPERATION_PULSE_DURATION_MS = 900;

/**
 * 操作エッジ・パルスの色。B層のピア接続（networkId ごとの青緑系パレット）や
 * C層の所有エッジ（琥珀 --own-edge）と混同しないよう、別系統のマゼンタにする。
 * 実際の CSS 変数は styles.css の --op-edge と一致させること。
 */
export const OPERATION_EDGE_COLOR = "var(--op-edge)";

/**
 * 操作エッジ上を 1 回走るパルス（光の点）1つ分の描画データ。
 * 進行方向は常に source（ワークベンチ）→ target（ノード）なので、peer のような
 * reverse フラグは持たない。
 */
export interface OperationPulse extends Record<string, unknown> {
  /** この描画インスタンスを一意に識別するキー（同じエッジ上の重複描画を区別）。 */
  key: string;
  /** パルスがエッジを渡り切るのにかける時間（ms）。 */
  durationMs: number;
}

export interface OperationEdgeData extends Record<string, unknown> {
  /** 直近に観測された呼び出しの種類（JSON-RPC メソッド名など）。ホバー表示用。 */
  operation: string;
  /** このエッジ上で現在走らせている操作パルス（1 本以上ある間だけエッジが存在する）。 */
  pulses: OperationPulse[];
}

export type OperationFlowEdge = Edge<OperationEdgeData>;

/**
 * WebSocket から届いた揮発性の操作観測イベントに、フロント側で採番した通し番号を
 * 付けたもの。`useOperationPulses` は seq をキーに「まだアニメーションしていない
 * イベント」を判定する（再レンダーで同じイベントを二重にアニメーションしない）。
 */
export interface OperationSignal {
  /** フロント側で単調増加する通し番号（重複排除キー）。 */
  seq: number;
  /** 観測された操作エッジ本体。 */
  edge: OperationEdge;
}

/** ワークベンチ → ノードのペアから、操作エッジの安定 ID を作る。 */
export function operationEdgeId(
  fromWorkbenchId: string,
  toNodeId: string,
): string {
  return `op-${fromWorkbenchId}=>${toNodeId}`;
}

/**
 * 観測された操作エッジを React Flow のエッジ（パルスなしの土台）へ変換する。
 *
 * - 端点（ワークベンチ・ノード）の両方がキャンバス上に存在しないと null を返す
 *   （宙ぶらりんのエッジを描かない）。片方でも欠けていればアニメーションしない。
 * - source = ワークベンチ、target = ノード。パルスは常に source → target へ流す。
 * - `data.pulses` は空で返す。パルスは `useOperationPulses` が付与する。
 */
export function buildOperationFlowEdge(
  edge: OperationEdge,
  presentInfraIds: Iterable<string>,
): OperationFlowEdge | null {
  const present =
    presentInfraIds instanceof Set
      ? presentInfraIds
      : new Set<string>(presentInfraIds);
  if (edge.fromWorkbenchId === edge.toNodeId) return null; // 自己ループは描かない
  if (!present.has(edge.fromWorkbenchId)) return null;
  if (!present.has(edge.toNodeId)) return null;

  return {
    id: operationEdgeId(edge.fromWorkbenchId, edge.toNodeId),
    type: OPERATION_EDGE_TYPE,
    source: edge.fromWorkbenchId,
    target: edge.toNodeId,
    data: { operation: edge.operation, pulses: [] },
    className: "operation-edge",
    style: { stroke: OPERATION_EDGE_COLOR, strokeWidth: 1.6 },
  };
}

/**
 * 操作エッジ配列に 1 つのパルスを追加した新しい配列を返す（純粋関数）。
 *
 * - 同じ端点ペアのエッジが既にあれば、そのエッジへパルスを足す（複数の呼び出しが
 *   同一ペア上で並行して光る）。`operation` は最新の観測値で上書きする。
 * - 無ければ `base` を土台にパルス 1 本のエッジを新規追加する。
 */
export function addOperationPulse(
  edges: OperationFlowEdge[],
  base: OperationFlowEdge,
  pulse: OperationPulse,
): OperationFlowEdge[] {
  const existing = edges.find((e) => e.id === base.id);
  if (existing) {
    const pulses = [...(existing.data?.pulses ?? []), pulse];
    return edges.map((e) =>
      e.id === base.id
        ? { ...e, data: { operation: base.data?.operation ?? "", pulses } }
        : e,
    );
  }
  return [...edges, { ...base, data: { ...base.data, operation: base.data?.operation ?? "", pulses: [pulse] } }];
}

/**
 * 操作エッジ配列から 1 つのパルスを取り除いた新しい配列を返す（純粋関数）。
 * そのエッジのパルスが 0 本になったら、エッジ自体を配列から落とす
 * （操作エッジはパルスが流れている間だけ存在する揮発性のエッジ）。
 */
export function removeOperationPulse(
  edges: OperationFlowEdge[],
  edgeId: string,
  pulseKey: string,
): OperationFlowEdge[] {
  const result: OperationFlowEdge[] = [];
  for (const edge of edges) {
    if (edge.id !== edgeId) {
      result.push(edge);
      continue;
    }
    const pulses = (edge.data?.pulses ?? []).filter((p) => p.key !== pulseKey);
    if (pulses.length === 0) continue; // パルスが尽きたらエッジごと消す
    result.push({
      ...edge,
      data: { operation: edge.data?.operation ?? "", pulses },
    });
  }
  return result;
}
