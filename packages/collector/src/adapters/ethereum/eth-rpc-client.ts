// Execution Layer クライアント（reth 等）へ HTTP JSON-RPC で問い合わせる部分。
// fetch への依存と JSON-RPC の語彙（eth_getBalance / eth_getTransactionCount）は
// このファイル（ChainAdapter 実装の内側）に閉じ込め、上位ロジックは
// EthRpcClient インターフェースだけに依存して実ノードなしでテストできるようにする。

export interface EthRpcClient {
  /**
   * 指定 URL へ JSON-RPC の単発リクエストを送り、result を返す。HTTP エラー・
   * JSON-RPC エラー・タイムアウトは例外として投げる。
   */
  call<T>(url: string, method: string, params: unknown[]): Promise<T>;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

/** グローバル fetch を用いた EthRpcClient 実装。 */
export function createFetchEthRpcClient(timeoutMs = 3000): EthRpcClient {
  return {
    async call<T>(url: string, method: string, params: unknown[]): Promise<T> {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
          signal: controller.signal,
        });
        if (!res.ok) {
          throw new Error(`RPC ${method} on ${url} failed with status ${res.status}`);
        }
        const body = (await res.json()) as JsonRpcResponse<T>;
        if (body.error) {
          throw new Error(
            `RPC ${method} on ${url} returned error ${body.error.code}: ${body.error.message}`,
          );
        }
        if (body.result === undefined) {
          throw new Error(`RPC ${method} on ${url} returned no result`);
        }
        return body.result;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * eth_getBalance の結果（16 進 wei）を 10 進の wei 文字列にして返す。
 * WalletEntity.balance は wei を文字列で保持する（精度落ち防止）ため、
 * BigInt を経由して桁落ちなく変換する。
 */
export async function fetchBalanceWei(
  rpc: EthRpcClient,
  url: string,
  address: string,
): Promise<string> {
  const hex = await rpc.call<string>(url, "eth_getBalance", [address, "latest"]);
  return BigInt(hex).toString(10);
}

/**
 * eth_getTransactionCount（latest）の結果（16 進）を数値の nonce にして返す。
 * nonce は tx 通し番号でありアカウント寿命内は安全に number に収まる。
 */
export async function fetchNonce(
  rpc: EthRpcClient,
  url: string,
  address: string,
): Promise<number> {
  const hex = await rpc.call<string>(url, "eth_getTransactionCount", [
    address,
    "latest",
  ]);
  return Number(BigInt(hex));
}
