import { vi } from "vitest";
import type { VcMetricsClient } from "../vc-metrics-client.js";

/**
 * VC（validator client）の `/metrics`（Prometheus テキスト形式）向けの
 * VcMetricsClient モックとレスポンス組み立てヘルパー。
 * reth-metrics-fixtures.ts の queuedRethMetricsClient/rethMetricsText と
 * 同型（Issue #420）。
 */

/**
 * `getText(url)` 呼び出しごとに、URL 単位で用意したレスポンスを先頭から
 * 1 件ずつ消費して返す `VcMetricsClient`。同一 URL への 2 回目以降の呼び出し
 * （周期ポーリングの複数 tick）で異なる累積値を返すことで、`VcMetricsTracker`
 * の増分計算をテストする。キューが尽きた URL への呼び出しは例外を投げる。
 */
export function queuedVcMetricsClient(
  byUrl: Record<string, string[]>,
): VcMetricsClient {
  return {
    getText: vi.fn(async (url: string) => {
      const queue = byUrl[url];
      if (!queue || queue.length === 0) {
        throw new Error(`no more VC metrics responses queued for ${url}`);
      }
      return queue.shift() as string;
    }),
  };
}

/**
 * VC の `/metrics` レスポンス（Prometheus テキスト形式）を組み立てる。
 * docs/worklog/issue-420.md「実測結果」の実機出力の形（histogram、
 * status ラベル、task ラベル）に合わせてある。`blockSigningSumSeconds` /
 * `attestationSubmitSumSeconds` を省略すると、対応する所要時間サンプル自体を
 * 出力しない（所要時間メトリクスが無いクライアントの縮退テスト用）。
 */
export function vcMetricsText(params: {
  blockProposalCount: number;
  attestationCount: number;
  blockSigningSumSeconds?: number;
  attestationSubmitSumSeconds?: number;
}): string {
  const lines = [
    "# TYPE vc_signed_beacon_blocks_total counter",
    `vc_signed_beacon_blocks_total{status="success"} ${params.blockProposalCount}`,
    "# TYPE vc_signed_attestations_total counter",
    `vc_signed_attestations_total{status="success"} ${params.attestationCount}`,
  ];
  if (params.blockSigningSumSeconds !== undefined) {
    lines.push(
      "# TYPE vc_block_signing_times_seconds histogram",
      `vc_block_signing_times_seconds_sum ${params.blockSigningSumSeconds}`,
      `vc_block_signing_times_seconds_count ${params.blockProposalCount}`,
    );
  }
  if (params.attestationSubmitSumSeconds !== undefined) {
    lines.push(
      "# TYPE vc_attestation_service_task_times_seconds histogram",
      `vc_attestation_service_task_times_seconds_sum{task="attestations_http_post"} ${params.attestationSubmitSumSeconds}`,
      `vc_attestation_service_task_times_seconds_count{task="attestations_http_post"} ${params.attestationCount}`,
    );
  }
  return lines.join("\n");
}
