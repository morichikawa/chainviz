// Ethereum の JSON-RPC を直接叩く薄いヘルパー。E2E から「追加した reth が
// 実際にブロックへ追従しているか」を実データで確認するために使う。RPC メソッド
// 名（eth_blockNumber 等）は Ethereum 固有の語彙であり、collector の
// ChainAdapter 境界の外側（この e2e パッケージ内）に閉じ込めている。

/** JSON-RPC を 1 回呼び出し、result を返す。HTTP/RPC エラーは throw する。 */
export async function jsonRpc<T>(
  url: string,
  method: string,
  params: unknown[] = [],
): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`RPC ${method} HTTP ${res.status} for ${url}`);
  }
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) {
    throw new Error(`RPC ${method} error: ${body.error.message}`);
  }
  return body.result as T;
}

/** eth_blockNumber を 10 進の数値で返す。到達不能なら throw。 */
export async function ethBlockNumber(rpcUrl: string): Promise<number> {
  const hex = await jsonRpc<string>(rpcUrl, "eth_blockNumber");
  return Number.parseInt(hex, 16);
}

/** reth コンテナの IP から JSON-RPC のベース URL を組み立てる。 */
export function rethRpcUrl(ip: string, port = 8545): string {
  return `http://${ip}:${port}`;
}
