// reth の Prometheus メトリクスエンドポイント（`/metrics`）へ HTTP で到達し、
// レスポンスボディをテキストのまま返す薄い IO 境界。http-client.ts の
// `HttpClient`（JSON 専用、`getJson`）とは別インターフェースにする。理由:
// `HttpClient` は beacon-api 系の既存テストが多数オブジェクトリテラルで
// 満たしており、ここに `getText` 等を追加すると本Issueと無関係な既存テストの
// 型が壊れる。docker/dockerode-client.ts・eth-rpc-client.ts と同じ「IO境界
// ごとに専用インターフェースを切る」流儀に合わせて独立させた
// （docs/worklog/issue-185.md 設計メモ参照）。

/** reth の Prometheus メトリクスのデフォルト待ち受けポート（Issue #184）。 */
export const EXECUTION_METRICS_PORT = 9001;

export interface RethMetricsClient {
  /** 指定 URL へ GET し、レスポンスボディをテキストのまま返す。 */
  getText(url: string): Promise<string>;
}

/**
 * グローバル fetch を用いた RethMetricsClient 実装。
 *
 * `timeoutMs` の既定値 3000ms の前提条件（Issue #185 レビューの申し送り。
 * CLAUDE.md「今この瞬間に観測できる状態に依存した固定値を埋め込まない」への
 * 対応）: これは同一 Docker ネットワーク内（collector と同じホスト上の
 * ノードコンテナ）へのスクレイプであり、チェーンの進行状態（稼働時間・
 * ブロック高）には依存しない値。`NODE_INTERNALS_POLL_INTERVAL_MS`
 * （reth-metrics-tracker.ts）と同値にしてあり、1 回のポーリング間隔内に
 * 取得が完了しない場合はそのノードの今回分の観測を諦めて次の間隔で
 * 再試行する、という考え方に揃えている。
 */
export function createFetchRethMetricsClient(
  timeoutMs = 3000,
): RethMetricsClient {
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
