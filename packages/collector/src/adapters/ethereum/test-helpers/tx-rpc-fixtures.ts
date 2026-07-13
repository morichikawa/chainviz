import type { EthRpcClient, RpcTransaction } from "../eth-rpc-client.js";

/**
 * Issue #309: peer-block-adapter.test.ts から切り出した共有fixture。
 * eth_getTransactionByHash / eth_getBlockReceipts 向けの EthRpcClient
 * モックと、非同期ハンドラの解決待ちヘルパー。
 */

/**
 * eth_getBlockReceipts の生の JSON-RPC レスポンス形状(正規化前)。stubRpcClient
 * は実際の HTTP レスポンス相当を返し、EthereumAdapter 経由で呼ばれる本物の
 * getBlockReceipts(normalizeReceipt を含む)がそれを正規化する。
 */
export interface RawReceiptFixture {
  transactionHash: string;
  from: string;
  to: string | null;
  /** "0x1"(成功) / "0x0"(失敗)。省略時は成功扱い。 */
  status?: string;
  /** コントラクト作成 tx でのみ非 null（Issue #160）。 */
  contractAddress?: string | null;
  /** tx が発したイベントログ（未復号の生データ、Issue #160）。 */
  logs?: { address: string; topics: string[]; data: string }[];
}

/** eth_getTransactionByHash / eth_getBlockReceipts を固定データで返すスタブ。 */
export function stubRpcClient(data: {
  txs?: Record<string, RpcTransaction | null>;
  blocks?: Record<string, RawReceiptFixture[] | null>;
}): {
  client: EthRpcClient;
  txCalls: string[];
  blockCalls: string[];
} {
  const txCalls: string[] = [];
  const blockCalls: string[] = [];
  const client: EthRpcClient = {
    async call<T>(_url: string, method: string, params: unknown[]): Promise<T> {
      if (method === "eth_getTransactionByHash") {
        const hash = params[0] as string;
        txCalls.push(hash);
        return (data.txs?.[hash] ?? null) as T;
      }
      if (method === "eth_getBlockReceipts") {
        const blockHash = params[0] as string;
        blockCalls.push(blockHash);
        return (data.blocks?.[blockHash] ?? null) as T;
      }
      throw new Error(`unexpected RPC method ${method}`);
    },
  };
  return { client, txCalls, blockCalls };
}

/** 非同期ハンドラ（handlePendingTx / handleBlockInclusion）の解決を待つ。 */
export async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
