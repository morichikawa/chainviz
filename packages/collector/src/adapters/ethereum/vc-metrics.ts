// lighthouse validator client（VC）の Prometheus メトリクス（ParsedMetrics）
// から D層（ノード内部可視化）の関心事を取り出す、VC 固有の解釈ロジック
// （純粋関数。状態を持たない）。メトリクス名・ラベル・型は
// docs/worklog/issue-420.md「実測結果」（実機の /metrics 出力で確認済み）に
// 記録した内容のとおり。
//
// 増分計算（前回値との差分・カウンタリセットの検知）は状態を要するため、
// 隣の vc-metrics-tracker.ts に分離してある（reth-metrics.ts /
// reth-metrics-tracker.ts と同じ分割）。

import { firstValue, samplesOf, type ParsedMetrics } from "./prom-text-parser.js";

/** ブロック提案（署名）の累積カウンタ。IntCounterVec、ラベル `status`。 */
const BLOCK_PROPOSAL_COUNTER_METRIC = "vc_signed_beacon_blocks_total";

/** 証明（attestation）の累積カウンタ。IntCounterVec、ラベル `status`。 */
const ATTESTATION_COUNTER_METRIC = "vc_signed_attestations_total";

/**
 * ブロック提案の署名所要時間。ラベル無しの Histogram。`_sum`/`_count` から
 * 区間平均を出す（reth の summary 型カウンタと同じ「_sum/_count を読む」
 * パース手法。TYPE が summary か histogram かは問わない。実機でも histogram
 * だったことを確認済み）。
 */
const BLOCK_SIGNING_TIME_METRIC = "vc_block_signing_times_seconds";

/**
 * 証明の提出 HTTP 呼び出しの所要時間（署名処理そのものではなく提出全体の
 * 時間の近似値）。`task` ラベルを持つ Histogram で、対象は
 * `task="attestations_http_post"` のサンプルのみ。
 */
const ATTESTATION_SUBMIT_TIME_METRIC = "vc_attestation_service_task_times_seconds";
const ATTESTATION_SUBMIT_TIME_TASK = "attestations_http_post";

/**
 * `status` ラベルが取りうる値のうち、実際に署名・証明が成立した場合の値。
 * `vc_block_signing_times_seconds`/`vc_attestation_service_task_times_seconds`
 * は status 別に分かれていない集計（ラベル無し、または task 別のみ）なので、
 * 「実測範囲では status=success のみ出現し、かつ signing_times の _count と
 * 一致していた」という実機観測（docs/worklog/issue-420.md）に基づき、
 * 所要時間は success の増分にのみ紐付ける（slashable/same_data/unregistered
 * には紐付けない）。
 */
const SUCCESS_STATUS = "success";

/**
 * VC の職務（提案/証明）1 種類ぶんの累積観測値（差分計算前の生値。
 * vc-metrics-tracker.ts が前回値との差分を取って InternalCallStats へ変換
 * する）。reth-metrics.ts の RawEngineCallCounter と同型。
 */
export interface RawValidatorDutyCounter {
  /**
   * 呼び出しの種類。Prometheus のメトリクスファミリー名と status ラベル値を
   * `:` で連結した生の識別子（例: "vc_signed_beacon_blocks_total:success"）。
   * reth の RawEngineCallCounter.method が生の JSON-RPC メソッド名をそのまま
   * 持つのと同じ「生の識別子をそのまま持ち、解釈はフロントが担う」流儀。
   */
  method: string;
  /** ノード起動からの呼び出し回数の累積値。 */
  count: number;
  /** ノード起動からの所要時間の累積合計（秒）。取得できた場合のみ。 */
  sumSeconds?: number;
}

/** `vc_attestation_service_task_times_seconds_sum` から対象 task のサンプルを探す。 */
function attestationSubmitSumSeconds(parsed: ParsedMetrics): number | undefined {
  const samples = samplesOf(parsed, `${ATTESTATION_SUBMIT_TIME_METRIC}_sum`);
  const sample = samples.find((s) => s.labels.task === ATTESTATION_SUBMIT_TIME_TASK);
  if (sample === undefined || !Number.isFinite(sample.value)) return undefined;
  return sample.value;
}

/**
 * `metricName{status="..."}` の各サンプルから RawValidatorDutyCounter を
 * 組み立てる。`status` ラベルが欠落・空文字のサンプル、値が有限数でない
 * サンプルは個別に読み捨てる（1件の乱れで全体を諦めない。reth-metrics.ts の
 * parseSyncStages と同じ流儀）。`successSumSeconds` は status="success" の
 * カウンタにのみ付与する。
 */
function parseDutyCounters(
  parsed: ParsedMetrics,
  metricName: string,
  successSumSeconds: number | undefined,
): RawValidatorDutyCounter[] {
  const counters: RawValidatorDutyCounter[] = [];
  for (const sample of samplesOf(parsed, metricName)) {
    const status = sample.labels.status;
    if (!status) continue;
    if (!Number.isFinite(sample.value)) continue;
    const counter: RawValidatorDutyCounter = {
      method: `${metricName}:${status}`,
      count: sample.value,
    };
    if (status === SUCCESS_STATUS && successSumSeconds !== undefined) {
      counter.sumSeconds = successSumSeconds;
    }
    counters.push(counter);
  }
  return counters;
}

/**
 * ブロック提案・証明それぞれの累積カウンタを読む。両方合わせて 1 つの配列で
 * 返す（vc-metrics-tracker.ts はノード×method ごとに差分を取るため、職務の
 * 種類を呼び出し側で区別する必要はない）。
 */
export function parseValidatorDutyCounters(
  parsed: ParsedMetrics,
): RawValidatorDutyCounter[] {
  const blockSigningSumSeconds = firstValue(parsed, `${BLOCK_SIGNING_TIME_METRIC}_sum`);
  const attestationSumSeconds = attestationSubmitSumSeconds(parsed);
  return [
    ...parseDutyCounters(
      parsed,
      BLOCK_PROPOSAL_COUNTER_METRIC,
      blockSigningSumSeconds,
    ),
    ...parseDutyCounters(
      parsed,
      ATTESTATION_COUNTER_METRIC,
      attestationSumSeconds,
    ),
  ];
}
