// Execution Layer クライアント（reth 等）へ HTTP JSON-RPC で問い合わせる部分。
// fetch への依存と JSON-RPC の語彙（eth_getBalance / eth_getTransactionByHash 等）は
// このファイル（ChainAdapter 実装の内側）に閉じ込め、上位ロジックは
// EthRpcClient インターフェース（汎用トランスポート）と、その上に載る
// ドメイン固有ヘルパー関数だけに依存して実ノードなしでテストできるようにする。

export interface EthRpcClient {
  /**
   * 指定 URL へ JSON-RPC の単発リクエストを送り、result を返す。HTTP エラー・
   * JSON-RPC エラー・タイムアウトは例外として投げる。
   */
  call<T>(url: string, method: string, params: unknown[]): Promise<T>;
}

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

/** 生の JSON-RPC tx オブジェクトを RpcTransaction へ正規化する（不正なら null）。 */
function normalizeTransaction(raw: unknown): RpcTransaction | null {
  if (typeof raw !== "object" || raw === null) return null;
  const tx = raw as RawTransaction;
  if (typeof tx.hash !== "string" || typeof tx.from !== "string") return null;
  const to = typeof tx.to === "string" ? tx.to : null;
  return { hash: tx.hash, from: tx.from, to };
}

/**
 * eth_getTransactionByHash で tx の詳細を取得する。未知のハッシュ（まだ
 * 伝播していない等）では null を返す。JSON-RPC では未知の tx は result=null で
 * 返るため、正規化して null を返す。
 */
export async function getTransactionByHash(
  rpc: EthRpcClient,
  rpcUrl: string,
  hash: string,
): Promise<RpcTransaction | null> {
  const raw = await rpc.call<unknown>(rpcUrl, "eth_getTransactionByHash", [hash]);
  return normalizeTransaction(raw);
}

/**
 * eth_getBlockByHash(fullTx=true) でブロックを取得し、含まれる tx 本体を
 * 返す。未知のブロックでは null を返す。
 */
export async function getBlockByHash(
  rpc: EthRpcClient,
  rpcUrl: string,
  blockHash: string,
): Promise<RpcBlock | null> {
  const raw = await rpc.call<RawBlock | null>(rpcUrl, "eth_getBlockByHash", [
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
}
