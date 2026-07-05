// reth の HTTP JSON-RPC（POST）へ eth_getTransactionByHash /
// eth_getBlockByHash を投げる薄いクライアント。newPendingTransactions で得た
// tx ハッシュの詳細（from/to）や、ブロックに含まれる tx 一覧を取得するために
// 使う。fetch 依存と JSON-RPC メソッド名という Ethereum 固有の語彙はこの
// ファイル（ChainAdapter 実装の内側）に閉じ込める。

/** eth_getTransactionByHash / ブロック内 tx から取り出す最小限の tx 情報。 */
export interface RpcTransaction {
  hash: string;
  from: string;
  /** コントラクト作成 tx では to は null。 */
  to: string | null;
}

/** eth_getBlockByHash(fullTx=true) から取り出すブロック（tx 本体を含む）。 */
export interface RpcBlock {
  hash: string;
  transactions: RpcTransaction[];
}

export interface EthRpcClient {
  /**
   * eth_getTransactionByHash で tx の詳細を取得する。未知のハッシュ（まだ
   * 伝播していない等）では null を返す。
   */
  getTransactionByHash(
    rpcUrl: string,
    hash: string,
  ): Promise<RpcTransaction | null>;

  /**
   * eth_getBlockByHash(fullTx=true) でブロックを取得し、含まれる tx 本体を
   * 返す。未知のブロックでは null を返す。
   */
  getBlockByHash(rpcUrl: string, blockHash: string): Promise<RpcBlock | null>;
}

interface JsonRpcResponse<T> {
  result?: T;
  error?: { code: number; message: string };
}

interface RawTransaction {
  hash?: unknown;
  from?: unknown;
  to?: unknown;
}

interface RawBlock {
  hash?: unknown;
  transactions?: unknown;
}

/** 生の JSON-RPC tx オブジェクトを RpcTransaction へ正規化する（不正なら null）。 */
function normalizeTransaction(raw: unknown): RpcTransaction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const tx = raw as RawTransaction;
  if (typeof tx.hash !== "string" || typeof tx.from !== "string") return null;
  const to = typeof tx.to === "string" ? tx.to : null;
  return { hash: tx.hash, from: tx.from, to };
}

/**
 * fetch を用いた EthRpcClient 実装。個々の呼び出しは timeoutMs で打ち切る
 * （応答が無い reth にぶら下がり続けないため）。JSON-RPC エラー・HTTP エラーは
 * 例外として送出し、呼び出し側（アダプタ）でログ・握り込みを判断させる。
 */
export function createFetchEthRpcClient(timeoutMs = 3000): EthRpcClient {
  async function call<T>(
    rpcUrl: string,
    method: string,
    params: unknown[],
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`POST ${rpcUrl} ${method} failed with status ${res.status}`);
      }
      const body = (await res.json()) as JsonRpcResponse<T>;
      if (body.error) {
        throw new Error(
          `${method} returned JSON-RPC error ${body.error.code}: ${body.error.message}`,
        );
      }
      return body.result as T;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async getTransactionByHash(rpcUrl, hash) {
      const raw = await call<unknown>(rpcUrl, "eth_getTransactionByHash", [hash]);
      return normalizeTransaction(raw);
    },
    async getBlockByHash(rpcUrl, blockHash) {
      const raw = await call<RawBlock | null>(rpcUrl, "eth_getBlockByHash", [
        blockHash,
        true,
      ]);
      if (typeof raw !== "object" || raw === null) return null;
      if (typeof raw.hash !== "string") return null;
      const txs = Array.isArray(raw.transactions)
        ? raw.transactions
            .map((t) => normalizeTransaction(t))
            .filter((t): t is RpcTransaction => t !== null)
        : [];
      return { hash: raw.hash, transactions: txs };
    },
  };
}
