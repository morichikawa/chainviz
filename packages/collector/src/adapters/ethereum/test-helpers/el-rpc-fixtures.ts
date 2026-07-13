import type { EthRpcClient } from "../eth-rpc-client.js";

/**
 * Issue #309: peer-block-adapter.test.ts から切り出した共有fixture。
 * EL（execution layer）の admin_* 系 RPC 向けの EthRpcClient モック。
 */

/**
 * rpcUrl 単位に admin_nodeInfo / admin_peers のレスポンス（または例外）を
 * 差し込める EthRpcClient。値は enode URL の生レスポンス形（`{ enode }`）や
 * ピア配列（`[{ enode }, ...]`）をそのまま渡す想定（正規化は el-peers.ts 側）。
 */
export function elRpcClient(
  byUrl: Record<
    string,
    {
      nodeInfo?: unknown;
      nodeInfoError?: Error;
      peers?: unknown;
      peersError?: Error;
    }
  >,
): EthRpcClient {
  return {
    async call<T>(url: string, method: string): Promise<T> {
      const cfg = byUrl[url];
      if (!cfg) throw new Error(`unexpected url ${url}`);
      if (method === "admin_nodeInfo") {
        if (cfg.nodeInfoError) throw cfg.nodeInfoError;
        return cfg.nodeInfo as T;
      }
      if (method === "admin_peers") {
        if (cfg.peersError) throw cfg.peersError;
        return (cfg.peers ?? []) as T;
      }
      throw new Error(`unexpected method ${method}`);
    },
  };
}

/** enode URL を組み立てる（128 桁 16 進の公開鍵を 1 バイトで埋める）。 */
export function enodeUrl(pubkeyByte: string, ip: string): string {
  return `enode://${pubkeyByte.repeat(64)}@${ip}:30303`;
}
