// reth の Prometheus メトリクス（ParsedMetrics）から D層（ノード内部可視化）の
// 関心事を取り出す、reth 固有の解釈ロジック（純粋関数。状態を持たない）。
// メトリクス名の実際の値は docs/worklog/issue-185.md「実環境での実測結果」に
// 記録した内容（実機の /metrics 出力を確認して決めた）。
//
// Engine API 呼び出しの「観測間隔内の増分」への変換（前回値との差分計算・
// カウンタリセットの検知）は状態を要するため、この隣の reth-metrics-tracker.ts
// に分離してある（このファイルは前回値を持たず、常に同じ入力に対して同じ
// 出力を返す）。

import type { SyncStageProgress } from "@chainviz/shared";
import { firstValue, samplesOf, type ParsedMetrics } from "./prom-text-parser.js";

/** ステージ型同期の進行状況を読むメトリクス名。gauge。 */
const SYNC_CHECKPOINT_METRIC = "reth_sync_checkpoint";

/** txpool の pending/queued 件数を読むメトリクス名。いずれも gauge。 */
const PENDING_POOL_METRIC = "reth_transaction_pool_pending_pool_transactions";
const QUEUED_POOL_METRIC = "reth_transaction_pool_queued_pool_transactions";

/**
 * reth の同期ステージのうち、実際にパイプラインが実行する順序が既知のもの
 * （docs/ARCHITECTURE.md §7.6.7 の表に合わせた順）。実測（実機の /metrics
 * 出力）で `reth_sync_checkpoint{stage=...}` サンプルの**出現順序はスクレイプ
 * のたびに変わる**ことを確認済み（reth 内部の HashMap 相当のイテレーション順と
 * みられ、パイプラインの実行順ではない）。そのため生テキストの出現順には頼らず、
 * この既知の順序で並べ替えることで `syncStages` 配列の順序に意味を持たせる
 * （docs/worklog/issue-185.md 参照。この並べ替えをしないと、
 * docs/ARCHITECTURE.md §7.6.5 が前提とする「配列順 = パイプライン実行順」の
 * フロント表示が成立しない）。
 */
const KNOWN_STAGE_ORDER = [
  "Headers",
  "Bodies",
  "SenderRecovery",
  "Execution",
  "AccountHashing",
  "StorageHashing",
  "MerkleExecute",
  "TransactionLookup",
  "IndexAccountHistory",
  "IndexStorageHistory",
  "Finish",
];

/**
 * ステージ名の比較関数。既知の順序（KNOWN_STAGE_ORDER）にあるものはその順で、
 * 無いもの（reth のバージョンにより増減しうる。例: MerkleUnwind / Prune /
 * PruneSenderRecovery / Era を実機で確認済み）は既知のステージより後ろに、
 * 互いの間はアルファベット順で並べる（安定した決定的な順序を保証するため。
 * 「未知でも隠さない」§7.6.5 の方針どおり、行自体は必ず出す）。
 */
function compareStageNames(a: string, b: string): number {
  const ai = KNOWN_STAGE_ORDER.indexOf(a);
  const bi = KNOWN_STAGE_ORDER.indexOf(b);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `reth_sync_checkpoint{stage="..."}` から SyncStageProgress[] を読む。
 * サンプルが1つも無ければ空配列（呼び出し側で「フィールド省略」に変換する）。
 * stage ラベルが欠落・空文字のサンプル、checkpoint が有限数でないサンプルは
 * 個別に読み捨てる（1件の乱れで全体を諦めない）。
 */
export function parseSyncStages(parsed: ParsedMetrics): SyncStageProgress[] {
  const stages: SyncStageProgress[] = [];
  for (const sample of samplesOf(parsed, SYNC_CHECKPOINT_METRIC)) {
    const stage = sample.labels.stage;
    if (!stage) continue;
    if (!Number.isFinite(sample.value)) continue;
    stages.push({ stage, checkpoint: sample.value });
  }
  return stages.sort((a, b) => compareStageNames(a.stage, b.stage));
}

/**
 * txpool の pending/queued 件数を読む。どちらか一方でも欠けていれば
 * undefined を返す（中途半端な値を NodeInternals.mempool に載せない）。
 */
export function parseMempool(
  parsed: ParsedMetrics,
): { pending: number; queued: number } | undefined {
  const pending = firstValue(parsed, PENDING_POOL_METRIC);
  const queued = firstValue(parsed, QUEUED_POOL_METRIC);
  if (pending === undefined || queued === undefined) return undefined;
  if (!Number.isFinite(pending) || !Number.isFinite(queued)) return undefined;
  return { pending, queued };
}

/**
 * Engine API 呼び出し 1 メソッドぶんの累積観測値（差分計算前の生値。
 * reth-metrics-tracker.ts が前回値との差分を取って InternalCallStats へ変換
 * する）。
 */
export interface RawEngineCallCounter {
  /**
   * 呼び出しの種類。バージョン付きの実際の JSON-RPC メソッド名（例:
   * "engine_newPayloadV4"）。reth の `# HELP reth_engine_rpc_new_payload_v4
   * Latency for \`engine_newPayloadV4\`` からバッククォート内の名前を
   * そのまま抜き出したもの（docs/worklog/issue-185.md 参照）。
   */
  method: string;
  /** ノード起動からの呼び出し回数の累積値。 */
  count: number;
  /** ノード起動からの所要時間の累積合計（秒）。取得できた場合のみ。 */
  sumSeconds?: number;
}

/** `# HELP` テキストからバッククォートで囲まれた `engine_...` メソッド名を抜き出す。 */
function extractEngineMethodName(help: string): string | undefined {
  const match = /`(engine_[A-Za-z0-9]+)`/.exec(help);
  return match?.[1];
}

/**
 * `reth_engine_rpc_<method>_v<N>`（summary 型）の各ファミリーから Engine API
 * 呼び出しの累積カウンタを読む。対象は「TYPE が summary」かつ「HELP コメントに
 * バッククォート付きの `engine_...` メソッド名が書かれている」ファミリーのみ
 * （blob 関連の一部等、この条件に合わないものは関心の対象外として黙って
 * 読み捨てる。reth が summary を増やしても壊れない縮退動作）。
 *
 * `<name>_count` が読めないファミリーは個別に読み捨てる（該当メソッドの
 * カウンタ自体が今回無かっただけで、他のメトリクス取得全体を失敗にはしない）。
 */
export function parseEngineCallCounters(
  parsed: ParsedMetrics,
): RawEngineCallCounter[] {
  const counters: RawEngineCallCounter[] = [];
  for (const [name, help] of parsed.help) {
    if (!name.startsWith("reth_engine_rpc_")) continue;
    if (parsed.type.get(name) !== "summary") continue;
    const method = extractEngineMethodName(help);
    if (!method) continue;
    const count = firstValue(parsed, `${name}_count`);
    if (count === undefined || !Number.isFinite(count)) continue;
    const sumSeconds = firstValue(parsed, `${name}_sum`);
    counters.push({
      method,
      count,
      ...(sumSeconds !== undefined && Number.isFinite(sumSeconds)
        ? { sumSeconds }
        : {}),
    });
  }
  return counters;
}
