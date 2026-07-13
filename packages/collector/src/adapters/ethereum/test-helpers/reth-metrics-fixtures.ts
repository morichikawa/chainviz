import { vi } from "vitest";
import type { RethMetricsClient } from "../reth-metrics-client.js";

/**
 * Issue #309: peer-block-adapter.test.ts から切り出した共有fixture。
 * reth の `/metrics`（Prometheus テキスト形式）向けの RethMetricsClient
 * モックとレスポンス組み立てヘルパー。
 */

/**
 * `getText(url)` 呼び出しごとに、URL 単位で用意したレスポンスを先頭から
 * 1 件ずつ消費して返す `RethMetricsClient`（Issue #186）。同一 URL への
 * 2 回目以降の呼び出し（周期ポーリングの複数 tick）で異なる累積値を返す
 * ことで、`RethMetricsTracker` の増分計算をテストする。キューが尽きた URL
 * への呼び出しは例外を投げる。
 */
export function queuedRethMetricsClient(
  byUrl: Record<string, string[]>,
): RethMetricsClient {
  return {
    getText: vi.fn(async (url: string) => {
      const queue = byUrl[url];
      if (!queue || queue.length === 0) {
        throw new Error(`no more reth metrics responses queued for ${url}`);
      }
      return queue.shift() as string;
    }),
  };
}

/** reth の `/metrics` レスポンス（Prometheus テキスト形式）を組み立てる。 */
export function rethMetricsText(engineCallCount: number): string {
  return [
    "# HELP reth_engine_rpc_new_payload_v4 Latency for `engine_newPayloadV4`",
    "# TYPE reth_engine_rpc_new_payload_v4 summary",
    `reth_engine_rpc_new_payload_v4_count ${engineCallCount}`,
    'reth_sync_checkpoint{stage="Headers"} 10',
    "reth_transaction_pool_pending_pool_transactions 1",
    "reth_transaction_pool_queued_pool_transactions 0",
  ].join("\n");
}

/**
 * `reth_sync_checkpoint{stage="Finish"}` を含む `/metrics` レスポンス
 * （Issue #187 の syncStatus/blockHeight テスト用）。
 */
export function rethMetricsTextWithFinish(finishCheckpoint: number): string {
  return [
    `reth_sync_checkpoint{stage="Headers"} ${finishCheckpoint}`,
    `reth_sync_checkpoint{stage="Finish"} ${finishCheckpoint}`,
    "reth_transaction_pool_pending_pool_transactions 0",
    "reth_transaction_pool_queued_pool_transactions 0",
  ].join("\n");
}
