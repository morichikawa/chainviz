// VC の職務カウンタ（RawValidatorDutyCounter、ノード起動からの累積値）を
// 前回スクレイプ時の値と突き合わせ、「観測間隔内の増分」（InternalCallStats）へ
// 変換する状態を持つ部分。vc-metrics.ts のパース自体は状態を持たない純粋関数
// にしてあるため、ノードごとの前回値の保持はこのファイルに閉じ込める。
//
// アルゴリズム自体は reth-metrics-tracker.ts の RethMetricsTracker と同一
// （Prometheus カウンタの差分計算という、reth/VC いずれのチェーン固有語彙も
// 含まない汎用ロジック）。docs/ARCHITECTURE.md §7.6.12 の設計判断どおり、
// 重複コストより「対象ごとに独立させる」既存の一貫性を優先し、共通クラスへの
// 統合はせず個別のクラスとして新設する。

import type { InternalCallStats } from "@chainviz/shared";
import type { RawValidatorDutyCounter } from "./vc-metrics.js";

interface PreviousCounter {
  count: number;
  sumSeconds?: number;
}

/**
 * ノードID×method（RawValidatorDutyCounter.method）ごとに前回の累積カウンタ
 * 値を保持し、今回値との差分を InternalCallStats[] として返す。
 * RethMetricsTracker.observe と同一のアルゴリズム:
 *
 * - 初回観測（そのノード×methodの前回値が無い）はベースラインの記録のみ
 *   行い、何も出力しない。
 * - カウンタリセット（今回値 < 前回値。VC プロセス再起動を意味する）は、
 *   増分 = 今回値として扱う（負の増分を配信しない）。
 * - 増分がゼロの method は出力に含めない。
 * - `latencyMs` は `sumSeconds` の増分をカウンタの増分で割った区間平均を
 *   ミリ秒に変換した値。今回・前回どちらかで `sumSeconds` が取れない場合は
 *   省略する。
 */
export class VcMetricsTracker {
  private readonly previous = new Map<string, Map<string, PreviousCounter>>();

  /**
   * 1ノード分の今回の観測（累積カウンタの配列）を記録し、前回との差分を
   * InternalCallStats[] として返す。
   */
  observe(
    nodeId: string,
    counters: RawValidatorDutyCounter[],
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
   * 指定ノードの前回値を破棄する（ノード削除時の後始末用。RethMetricsTracker
   * と同じ用途）。
   */
  forgetNode(nodeId: string): void {
    this.previous.delete(nodeId);
  }
}
