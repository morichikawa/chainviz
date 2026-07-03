// GET-only JSON HTTP クライアントの薄い抽象。Beacon API のような HTTP
// エンドポイントへの到達手段をインターフェースに切り出し、上位ロジックを
// 実ネットワークなしでテストできるようにする。実装（fetch 依存）はこの
// ファイルに閉じ込める（docker/dockerode-client.ts と同じ IO 境界の扱い）。

export interface HttpClient {
  /** 指定 URL へ GET し、レスポンスボディを JSON として返す。 */
  getJson<T>(url: string): Promise<T>;
}

/** グローバル fetch を用いた HttpClient 実装。 */
export function createFetchHttpClient(timeoutMs = 3000): HttpClient {
  return {
    async getJson<T>(url: string): Promise<T> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, { signal: controller.signal });
        if (!res.ok) {
          throw new Error(`GET ${url} failed with status ${res.status}`);
        }
        return (await res.json()) as T;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
