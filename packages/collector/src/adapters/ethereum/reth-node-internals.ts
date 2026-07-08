// 1ノード分の「メトリクス取得 → パース → 解釈 → 差分計算」を束ねる
// オーケストレーション層。#186（NodeEntity.internals へのworld-state反映・
// nodeLinkActivityの配信・drivesNodeIdの解決）がノードごとに呼び出す想定の
// エントリポイントで、Prometheus・reth 固有の語彙（ParsedMetrics 等）を
// これより上のレイヤーへ漏らさない（CLAUDE.md「ChainAdapter 境界」）。

import type { InternalCallStats, NodeInternals } from "@chainviz/shared";
import { parsePrometheusText } from "./prom-text-parser.js";
import {
  parseEngineCallCounters,
  parseMempool,
  parseSyncStages,
} from "./reth-metrics.js";
import type { RethMetricsClient } from "./reth-metrics-client.js";
import type { RethMetricsTracker } from "./reth-metrics-tracker.js";

/** ノード内部メトリクスのポーリング対象 1 件（targets.ts の他の Target 型と同型）。 */
export interface RethNodeInternalsTarget {
  /** ノードの安定識別子（NodeEntity.id と一致）。 */
  stableId: string;
  /** `/metrics` の URL（`http://<コンテナIP>:9001/metrics`）。 */
  metricsUrl: string;
}

export interface RethNodeInternalsResult {
  /** syncStages・mempool のいずれも観測できなければ省略。 */
  internals?: NodeInternals;
  /** この観測間隔で増分のあった Engine API 呼び出し（無ければ空配列）。 */
  calls: InternalCallStats[];
}

/**
 * 1ノード分のノード内部メトリクスを 1 回分ポーリングする。
 *
 * 取得（HTTP）・パース（Prometheus テキスト形式として解釈できない）に失敗
 * した場合は、対象の stableId と実際のエラー内容を `console.error` に残した
 * うえで `undefined` を返す（縮退動作。呼び出し側はこのノードの今回分の観測を
 * スキップする。CLAUDE.md「エラーを握りつぶすコードを見逃さない」）。
 *
 * 個々のフィールド（syncStages・mempool・Engine API 呼び出し）が読めない
 * ケースは reth-metrics.ts / reth-metrics-tracker.ts 側で「想定内の縮退」
 * として個別に読み捨てられており、ここでは追加のログは出さない
 * （reth のバージョン差でメトリクスの一部が無いことは異常ではないため。
 * docs/worklog/issue-185.md 参照）。
 */
export async function pollRethNodeInternals(
  client: RethMetricsClient,
  target: RethNodeInternalsTarget,
  tracker: RethMetricsTracker,
): Promise<RethNodeInternalsResult | undefined> {
  let text: string;
  try {
    text = await client.getText(target.metricsUrl);
  } catch (err) {
    console.error(
      `[ethereum] reth metrics fetch failed for ${target.stableId} (${target.metricsUrl}):`,
      err,
    );
    return undefined;
  }

  let parsed: ReturnType<typeof parsePrometheusText>;
  try {
    parsed = parsePrometheusText(text);
  } catch (err) {
    console.error(
      `[ethereum] reth metrics parse failed for ${target.stableId} (${target.metricsUrl}):`,
      err,
    );
    return undefined;
  }

  if (parsed.samples.size === 0) {
    // レスポンス自体は取得できたが、Prometheus テキストとして1件もサンプルを
    // 読めなかった（エンドポイントの形式が想定と異なる・空レスポンス等）。
    // 完全な取得失敗と同じ扱いでログを残す。
    console.error(
      `[ethereum] reth metrics response for ${target.stableId} (${target.metricsUrl}) had no parsable samples`,
    );
    return undefined;
  }

  const syncStages = parseSyncStages(parsed);
  const mempool = parseMempool(parsed);
  const engineCounters = parseEngineCallCounters(parsed);
  const calls = tracker.observe(target.stableId, engineCounters);

  const internals: NodeInternals = {};
  if (syncStages.length > 0) internals.syncStages = syncStages;
  if (mempool) internals.mempool = mempool;
  const hasInternals =
    internals.syncStages !== undefined || internals.mempool !== undefined;

  return { internals: hasInternals ? internals : undefined, calls };
}
