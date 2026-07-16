// Engine API 呼び出しカウンタ（RawEngineCallCounter、ノード起動からの累積値）を
// 前回スクレイプ時の値と突き合わせ、「観測間隔内の増分」（InternalCallStats）へ
// 変換する状態を持つ部分。reth-metrics.ts のパース自体は状態を持たない純粋関数
// にしてあるため、ノードごとの前回値の保持はこのファイルに閉じ込める。

import type { InternalCallStats } from "@chainviz/shared";
import type { RawEngineCallCounter } from "./reth-metrics.js";

interface PreviousCounter {
  count: number;
  sumSeconds?: number;
}

/**
 * ノード内部の Engine API 観測を周期実行する際の既定スクレイプ間隔。
 *
 * この値の前提条件（CLAUDE.md「今この瞬間に観測できる状態に依存した固定値を
 * 埋め込まない」への対応）: 3 秒はチェーンの進行状態（稼働時間・ブロック高・
 * カウンタの絶対値）に依存しないサンプリング周期であり、増分ベースの観測
 * （本モジュールが差分を取る設計）なので絶対値がどれだけ大きくなっても壊れない。
 * genesis slot time（現実の Ethereum に合わせ 12 秒）はこのスクレイプ間隔より
 * 長いため、1 スクレイプ間隔に必ず Engine API 呼び出しが乗るわけではなく、
 * 数回に1回のスクレイプで slot 分の増分をまとめて観測する（差分ベースなので
 * 増分ゼロのスクレイプが混じっても正しく動く）。逆に slot time をこの間隔
 * より大幅に短くする場合は、1 slot 分の呼び出しを取りこぼさないようこの値も
 * 見直すこと（docs/ARCHITECTURE.md §7.2）。既存の PEER_POLL_INTERVAL_MS /
 * WALLET_POLL_INTERVAL_MS と同じ値・同じ考え方（実際の setInterval ループの
 * 配線は Issue #186 が行う。値の根拠は本Issueのスコープなのでここに置く）。
 */
export const NODE_INTERNALS_POLL_INTERVAL_MS = 3000;

/**
 * ノードID×メソッド名ごとに前回の累積カウンタ値を保持し、今回値との差分を
 * InternalCallStats[] として返す。
 *
 * - **初回観測**（そのノード×メソッドの前回値が無い）はベースラインの記録のみ
 *   行い、何も出力しない。collector 起動時点で既にノードが稼働していた場合、
 *   「ノード起動からの累積値」をそのまま「この1回のスクレイプ間隔の増分」として
 *   誤配信しないため（通常の Prometheus カウンタ→レート変換と同じ考え方）。
 * - **カウンタリセット**（今回値 < 前回値。ノード再起動を意味する）は、増分 =
 *   今回値として扱う（負の増分を配信しない。docs/ARCHITECTURE.md §7.2）。
 *   所要時間合計（sumSeconds）も同時にリセットされる前提で同じ扱いにする。
 * - 増分がゼロのメソッドは出力に含めない（InternalCallStats.count は「1 以上、
 *   増分ゼロの種類は載せない」という契約）。
 * - `latencyMs` は `sumSeconds` の増分をカウンタの増分で割った区間平均を
 *   ミリ秒に変換した値。今回・前回どちらかで `sumSeconds` が取れない場合は
 *   省略する（所要時間メトリクスが無いクライアント・reth バージョンでの
 *   縮退動作）。
 */
export class RethMetricsTracker {
  private readonly previous = new Map<string, Map<string, PreviousCounter>>();

  /**
   * 1ノード分の今回の観測（累積カウンタの配列）を記録し、前回との差分を
   * InternalCallStats[] として返す。
   */
  observe(
    nodeId: string,
    counters: RawEngineCallCounter[],
  ): InternalCallStats[] {
    let byMethod = this.previous.get(nodeId);
    if (!byMethod) {
      byMethod = new Map();
      this.previous.set(nodeId, byMethod);
    }

    const results: InternalCallStats[] = [];
    for (const counter of counters) {
      const prev = byMethod.get(counter.method);
      byMethod.set(counter.method, {
        count: counter.count,
        sumSeconds: counter.sumSeconds,
      });
      if (!prev) continue; // 初回観測: ベースラインのみ記録し、出力しない。

      const reset = counter.count < prev.count;
      const deltaCount = reset ? counter.count : counter.count - prev.count;
      if (deltaCount <= 0) continue;

      const deltaSumSeconds =
        counter.sumSeconds !== undefined && prev.sumSeconds !== undefined
          ? reset
            ? counter.sumSeconds
            : counter.sumSeconds - prev.sumSeconds
          : undefined;

      const stat: InternalCallStats = { method: counter.method, count: deltaCount };
      if (deltaSumSeconds !== undefined && deltaSumSeconds >= 0) {
        stat.latencyMs = (deltaSumSeconds / deltaCount) * 1000;
      }
      results.push(stat);
    }
    return results;
  }

  /**
   * 指定ノードの前回値を破棄する（ノード削除時の後始末用。#186 が
   * removeNode と連動させる想定。呼ばなくてもメモリは既知の少数メソッド名
   * ぶんしか増えないため実害は小さいが、削除済みノードの残留を避けるために
   * 用意する）。
   */
  forgetNode(nodeId: string): void {
    this.previous.delete(nodeId);
  }
}
