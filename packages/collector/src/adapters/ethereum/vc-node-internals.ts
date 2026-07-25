// 1 VC（validator client）ノード分の「メトリクス取得 → パース → 解釈 →
// 差分計算」を束ねるオーケストレーション層。reth-node-internals.ts の
// pollRethNodeInternals と同型だが、VC の同期状態・mempool 相当の内部状態は
// 今回のスコープに含めないため NodeInternals パッチは返さない
// （docs/ARCHITECTURE.md §7.6.12）。Prometheus・lighthouse 固有の語彙を
// これより上のレイヤーへ漏らさない（CLAUDE.md「ChainAdapter 境界」）。

import type { InternalCallStats } from "@chainviz/shared";
import { parsePrometheusText } from "./prom-text-parser.js";
import { parseValidatorDutyCounters } from "./vc-metrics.js";
import type { VcMetricsClient } from "./vc-metrics-client.js";
import type { VcMetricsTracker } from "./vc-metrics-tracker.js";
import type { ValidatorMetricsTarget } from "./targets.js";

/**
 * 1 VC ノード分の職務メトリクスを 1 回分ポーリングする。
 *
 * 取得（HTTP）・パース（Prometheus テキスト形式として解釈できない）に失敗
 * した場合は、対象の stableId と実際のエラー内容を `console.error` に残した
 * うえで `undefined` を返す（縮退動作。呼び出し側はこの VC の今回分の観測を
 * スキップする。reth-node-internals.ts の pollRethNodeInternals と同じ方針。
 * CLAUDE.md「エラーを握りつぶすコードを見逃さない」）。
 *
 * ブロック提案・証明のいずれのカウンタも読めなかった（メトリクス自体は
 * 取得できたが対象の職務カウンタが 1 件も無かった）場合は空配列を返す
 * （エラーではない縮退動作。reth-metrics.ts のフィールド単位の縮退と同じ
 * 考え方）。
 */
export async function pollVcNodeInternals(
  client: VcMetricsClient,
  target: ValidatorMetricsTarget,
  tracker: VcMetricsTracker,
): Promise<InternalCallStats[] | undefined> {
  let text: string;
  try {
    text = await client.getText(target.metricsUrl);
  } catch (err) {
    console.error(
      `[ethereum] VC metrics fetch failed for ${target.stableId} (${target.metricsUrl}):`,
      err,
    );
    return undefined;
  }

  let parsed: ReturnType<typeof parsePrometheusText>;
  try {
    parsed = parsePrometheusText(text);
  } catch (err) {
    console.error(
      `[ethereum] VC metrics parse failed for ${target.stableId} (${target.metricsUrl}):`,
      err,
    );
    return undefined;
  }

  if (parsed.samples.size === 0) {
    // レスポンス自体は取得できたが、Prometheus テキストとして1件もサンプルを
    // 読めなかった（エンドポイントの形式が想定と異なる・空レスポンス等）。
    // 完全な取得失敗と同じ扱いでログを残す。
    console.error(
      `[ethereum] VC metrics response for ${target.stableId} (${target.metricsUrl}) had no parsable samples`,
    );
    return undefined;
  }

  const dutyCounters = parseValidatorDutyCounters(parsed);
  return tracker.observe(target.stableId, dutyCounters);
}
