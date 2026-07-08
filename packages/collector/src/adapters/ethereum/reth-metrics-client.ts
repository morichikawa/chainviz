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

/** グローバル fetch を用いた RethMetricsClient 実装。 */
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
