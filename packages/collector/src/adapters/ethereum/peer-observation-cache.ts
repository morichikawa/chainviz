// ノード単位のピア観測キャッシュ（Issue #288）。
//
// `fetchConsensusPeerNodes`（Beacon API 側）は 1 回の問い合わせ失敗ごとに
// そのノードの NodePeers を丸ごと落としていたため、実際の P2P 接続は維持
// されたまま API 応答が一時的に遅延しただけでも、そのノードが関わる全ての
// PeerEdge が消える「フラッピング」が起きていた（詳細は
// docs/worklog/issue-288.md の設計メモを参照）。
//
// このクラスは stableId ごとに「連続失敗回数」と「最後に観測できた
// NodePeers（lastGood）」を持ち、失敗が猶予（graceTicks）以内であれば
// lastGood を代用として返せるようにする。`toPeerEdges` 以降のロジックは
// この代用された NodePeers を通常の観測結果と区別せずに扱うため無変更で
// 済む（設計判断: PeerEdge に stale フラグ等は追加しない）。

import type { NodePeers } from "./peers.js";

interface ObservationEntry {
  consecutiveFailures: number;
  lastGood?: NodePeers;
}

/** `recordFailure` の戻り値。 */
export interface PeerObservationFailureResult {
  /** 直近の成功以降、何回連続で失敗しているか（今回の失敗を含む）。 */
  consecutiveFailures: number;
  /**
   * 猶予内かつ過去に成功した観測があれば、その NodePeers を代用として返す。
   * 猶予を超えた、または一度も成功していない場合は undefined
   * （= 呼び出し側は従来どおり観測を落とす）。
   */
  fallback: NodePeers | undefined;
}

/**
 * ノード単位のピア観測キャッシュ。連続失敗回数と最後に成功した観測を持ち、
 * 短期的な観測失敗をヒステリシスで吸収する。CL（Beacon API）専用ではなく
 * `NodePeers` を扱う汎用実装（現時点では CL 側のみ配線。EL 側で同様の
 * 症状が実測されたら配線を追加できる）。
 */
export class PeerObservationCache {
  private readonly entries = new Map<string, ObservationEntry>();

  /**
   * @param graceTicks 観測失敗が何回連続するまで直前の成功観測を代用して
   *   良いか。呼び出し側のポーリング間隔に対する相対値（tick 数）で表す
   *   ことで、間隔設定を変えても猶予の相対頻度が変わらないようにする
   *   （具体的な実時間の見積もりは呼び出し側の定数コメントを参照）。
   */
  constructor(private readonly graceTicks: number) {}

  /** 観測成功。連続失敗回数をリセットし、lastGood を更新する。 */
  recordSuccess(stableId: string, observed: NodePeers): void {
    this.entries.set(stableId, { consecutiveFailures: 0, lastGood: observed });
  }

  /**
   * 観測失敗。連続失敗回数をインクリメントして返す。
   * fallback は「連続失敗回数 <= graceTicks かつ lastGood が存在する」
   * 場合のみ返す（それ以外は undefined = 従来どおり観測を落とす）。
   *
   * 猶予を超えたあとも lastGood 自体は破棄しない（`prune` でのみ破棄する）。
   * 破棄する分岐を追加しても外形挙動（fallback が返るかどうかは
   * consecutiveFailures との比較で決まる）は変わらないため、実装を単純に
   * 保つ。
   */
  recordFailure(stableId: string): PeerObservationFailureResult {
    const prev = this.entries.get(stableId) ?? { consecutiveFailures: 0 };
    const consecutiveFailures = prev.consecutiveFailures + 1;
    const entry: ObservationEntry = { ...prev, consecutiveFailures };
    this.entries.set(stableId, entry);

    const fallback =
      consecutiveFailures <= this.graceTicks && entry.lastGood
        ? entry.lastGood
        : undefined;
    return { consecutiveFailures, fallback };
  }

  /**
   * 現在の観測対象に含まれない stableId のエントリを破棄する
   * （ノード削除等で観測から消えたノードのキャッシュが猶予によって
   * ゾンビエッジを作り続けないようにする）。呼び出し側はポーリングの
   * 冒頭で毎回、現在の対象集合を渡して呼ぶこと。
   */
  prune(currentIds: ReadonlySet<string>): void {
    for (const id of this.entries.keys()) {
      if (!currentIds.has(id)) this.entries.delete(id);
    }
  }
}
