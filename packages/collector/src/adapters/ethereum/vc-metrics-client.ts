// lighthouse validator client（VC）の Prometheus メトリクスエンドポイント
// （`/metrics`）へ HTTP で到達し、レスポンスボディをテキストのまま返す薄い
// IO 境界。reth-metrics-client.ts と同型だが、既存コードの「IO境界ごとに
// 専用インターフェースを切る」流儀（docs/ARCHITECTURE.md §7.6.12・
// docs/worklog/issue-185.md 設計メモ参照）にそろえ、reth 用とは別の
// インターフェースとして独立させている。

/** lighthouse VC の Prometheus メトリクスのデフォルト待ち受けポート（Issue #420）。 */
export const VALIDATOR_METRICS_PORT = 5064;

export interface VcMetricsClient {
  /** 指定 URL へ GET し、レスポンスボディをテキストのまま返す。 */
  getText(url: string): Promise<string>;
}

/**
 * グローバル fetch を用いた VcMetricsClient 実装。
 *
 * `timeoutMs` の既定値 3000ms の前提条件（reth-metrics-client.ts と同じ
 * 考え方。CLAUDE.md「今この瞬間に観測できる状態に依存した固定値を埋め込まない」
 * への対応）: 同一 Docker ネットワーク内（collector と同じホスト上の VC
 * コンテナ）へのスクレイプであり、チェーンの進行状態には依存しない値。
 * `NODE_INTERNALS_POLL_INTERVAL_MS`（reth-metrics-tracker.ts。D層の周期
 * ループに相乗りするため VC 側も同じ間隔を使う）と同値にしてある。
 */
export function createFetchVcMetricsClient(timeoutMs = 3000): VcMetricsClient {
  return {
    async getText(url: string): Promise<string> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`GET ${url} failed with status ${res.status}`);
        }
        return await res.text();
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
