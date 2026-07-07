import type { BlockEntity } from "@chainviz/shared";
import type { EdgePulse, PeerFlowEdge } from "./peerEdge.js";

/**
 * ブロック伝播パルスのタイミング計算（純粋関数）。
 *
 * collector が記録した各ノードのブロック受信実時刻（`BlockEntity.receivedAt`）を
 * もとに、「どのノードから・どのノードへ・どれくらいの時間差で伝播したか」を
 * エッジ単位のパルス区間へ変換する。CSS/SVG のアニメーション自体とは切り離し、
 * ここではデータ変換だけを行う（テスト容易性のため）。
 *
 * docs/CONCEPT.md「ブロック伝播のリアルタイム表現」の方針に従う:
 * - 実データの相対順序（どちらが先に受信したか）と時間差の比率を尊重する。
 * - ただし実環境では同一ホスト上のノード間で受信差が数 ms しかなく、そのままでは
 *   知覚できないため、視認可能な最低表示時間（フロア）を設ける。これは演出上の
 *   誇張ではなく「実差分が知覚不能なときの UX 上の最低表示時間」であり、実差分が
 *   フロアより大きければ実データの差分をそのまま使う。将来 tc netem 等で実遅延が
 *   数百 ms 単位になれば自然に実データが支配する。
 */

/** 実差分が知覚不能なときに用いる、パルスの最低表示時間（ms）。 */
export const MIN_PULSE_DURATION_MS = 450;

/**
 * ブロックを「新しい」とみなす既定の鮮度ウィンドウ（ms）。これより古い受信は
 * 再接続時のスナップショットに含まれる過去ブロックとみなし、アニメーションしない。
 */
export const DEFAULT_FRESHNESS_MS = 6000;

export interface BlockPulseOptions {
  /** 最低表示時間（ms）。既定は `MIN_PULSE_DURATION_MS`。 */
  minDurationMs?: number;
}

/**
 * 1本のエッジ上を走るパルスの、実データに基づくタイミング区間。
 * `startDelayMs` は波の起点（最初の受信ノード）を基準にした出発遅延。
 */
export interface BlockPulseSegment {
  /** 対応する `PeerFlowEdge.id`。 */
  edgeId: string;
  /** 先に受信した側のノード ID（パルスの出発点）。 */
  fromNodeId: string;
  /** 後に受信した側のノード ID（パルスの到達点）。 */
  toNodeId: string;
  /** エッジの正規化順（source=小, target=大）に対し逆向きに走るか。 */
  reverse: boolean;
  /** 波の起点（最初の受信時刻 t0）を基準にした出発遅延（ms, 0 以上）。 */
  startDelayMs: number;
  /** エッジを渡り切る時間（ms）。実差分にフロアを適用済み。 */
  durationMs: number;
}

/**
 * `receivedAt` のうち有限数の受信時刻だけを返す。有限数でない値
 * （NaN / ±Infinity）は「未受信」として無視する（NaN が Math.min/max を
 * 汚染して durationMs へ伝播するのを防ぐ、純粋関数側の契約）。
 */
function finiteReceiptTimes(block: BlockEntity): number[] {
  return Object.values(block.receivedAt).filter((t) => Number.isFinite(t));
}

/**
 * ブロックの受信時刻のうち最も早いもの（= 波の起点 t0）。未受信なら null。
 *
 * Issue #141: `receivedAt` にはCL(beacon)キーとEL(reth)キーが混在しうる。
 * 通常のEthereumプロファイル構成（全executionノードがbeaconを伴う）では
 * CLキーとELキーは同一受信イベントの複製（同じ時刻）なのでt0は変わらない。
 * ただしbeaconを持たないEL onlyノードが存在する構成では、そのELキーが
 * 最速受信になりt0がCL側より早まりうる。これは「ブロックがネットワーク
 * 全体で最初に観測された時刻」として妥当な挙動であり、実プロファイル
 * （全ノードがbeacon対）では発生しない。
 */
export function waveOriginTime(block: BlockEntity): number | null {
  const times = finiteReceiptTimes(block);
  if (times.length === 0) return null;
  return Math.min(...times);
}

/** ブロックの受信時刻のうち最も遅いもの（= 波の最新イベント）。未受信なら null。 */
export function latestReceiptTime(block: BlockEntity): number | null {
  const times = finiteReceiptTimes(block);
  if (times.length === 0) return null;
  return Math.max(...times);
}

/**
 * ブロックが「今アニメーションすべき新しさ」かを判定する。最新受信時刻が
 * 現在時刻から `maxAgeMs` 以内なら新しいとみなす。再接続時のスナップショットに
 * 含まれる過去ブロックを一斉に光らせないためのガード。
 */
export function isFreshBlock(
  block: BlockEntity,
  now: number,
  maxAgeMs: number = DEFAULT_FRESHNESS_MS,
): boolean {
  const latest = latestReceiptTime(block);
  if (latest === null) return false;
  return now - latest <= maxAgeMs;
}

/**
 * ブロックの受信時刻とピア接続（エッジ）から、エッジ単位のパルス区間を算出する。
 *
 * - 両端点がともに `receivedAt` に記録されているエッジだけが対象（片側しか
 *   受信していないと伝播方向が確定しないため描かない）。有限数でない受信時刻
 *   （NaN / ±Infinity）を持つ端点も「未受信」として扱う。
 * - 早く受信した側が出発点、遅く受信した側が到達点。
 * - 表示時間は実差分（laterTime - earlierTime）にフロアを適用したもの。
 * - 出力は `edgeId` 昇順で安定ソートする。
 */
export function computeBlockPulses(
  block: BlockEntity,
  edges: PeerFlowEdge[],
  options: BlockPulseOptions = {},
): BlockPulseSegment[] {
  const minDuration = options.minDurationMs ?? MIN_PULSE_DURATION_MS;
  const t0 = waveOriginTime(block);
  if (t0 === null) return [];

  const received = block.receivedAt;
  const segments: BlockPulseSegment[] = [];

  for (const edge of edges) {
    const sourceTime = received[edge.source];
    const targetTime = received[edge.target];
    // 未記録に加え、有限数でない受信時刻（NaN / ±Infinity）も「未受信」として
    // 除外する（NaN が durationMs へ伝播し dur="NaNms" になるのを防ぐ）。
    if (sourceTime === undefined || !Number.isFinite(sourceTime)) continue;
    if (targetTime === undefined || !Number.isFinite(targetTime)) continue;

    let fromNodeId: string;
    let toNodeId: string;
    let earlierTime: number;
    let laterTime: number;
    let reverse: boolean;

    if (targetTime < sourceTime) {
      // 大側（target）が先に受信 → 正規化順に対して逆走。
      fromNodeId = edge.target;
      toNodeId = edge.source;
      earlierTime = targetTime;
      laterTime = sourceTime;
      reverse = true;
    } else {
      fromNodeId = edge.source;
      toNodeId = edge.target;
      earlierTime = sourceTime;
      laterTime = targetTime;
      reverse = false;
    }

    const rawDiff = laterTime - earlierTime;
    const durationMs = Math.max(rawDiff, minDuration);
    const startDelayMs = Math.max(0, earlierTime - t0);

    segments.push({
      edgeId: edge.id,
      fromNodeId,
      toNodeId,
      reverse,
      startDelayMs,
      durationMs,
    });
  }

  segments.sort((a, b) => a.edgeId.localeCompare(b.edgeId));
  return segments;
}

/** ブロックハッシュとエッジ ID から、パルスのスケジュール重複排除キーを作る。 */
export function pulseSeenKey(blockHash: string, edgeId: string): string {
  return `${blockHash}::${edgeId}`;
}

/** フックが実際に描画中のパルス1つ分（`EdgePulse` にどのエッジ上かを付けたもの）。 */
export interface ActivePulse extends EdgePulse {
  edgeId: string;
}

/**
 * 描画中のパルス群をエッジ配列にひも付け、各エッジの `data.pulses` を更新した
 * 新しい配列を返す（純粋関数）。パルスが無いエッジは元の参照を保つ。
 */
export function attachPulsesToEdges(
  edges: PeerFlowEdge[],
  active: ActivePulse[],
): PeerFlowEdge[] {
  const byEdge = new Map<string, EdgePulse[]>();
  for (const pulse of active) {
    const entry: EdgePulse = {
      key: pulse.key,
      reverse: pulse.reverse,
      durationMs: pulse.durationMs,
    };
    const bucket = byEdge.get(pulse.edgeId);
    if (bucket) bucket.push(entry);
    else byEdge.set(pulse.edgeId, [entry]);
  }

  return edges.map((edge) => {
    const pulses = byEdge.get(edge.id);
    const hadPulses = (edge.data?.pulses?.length ?? 0) > 0;
    if (!pulses && !hadPulses) return edge; // 変化なし → 参照を保つ
    const data = edge.data ?? { networkId: "" };
    return { ...edge, data: { ...data, pulses } };
  });
}
