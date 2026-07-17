// fetchGenesisHash（Issue #357: チェーンリセット検知の基礎になる genesis
// ハッシュ取得）のユニットテスト。eth-rpc-client.test.ts は既に他の RPC
// ヘルパー（fetchBalanceWei/getTransactionByHash 等）で肥大化しているため、
// 新規の関心事は分離した専用ファイルに置く（CLAUDE.md「テストファイルにも
// 1ファイル1責務を適用する」）。

import { describe, expect, it } from "vitest";
import { fetchGenesisHash, type EthRpcClient } from "./eth-rpc-client.js";

/** call をスタブする最小の EthRpcClient（eth-rpc-client.test.ts と同型）。 */
function stubRpc(
  handler: (method: string, params: unknown[]) => unknown,
): EthRpcClient {
  return {
    async call<T>(_url: string, method: string, params: unknown[]): Promise<T> {
      return handler(method, params) as T;
    },
  };
}

describe("fetchGenesisHash", () => {
  it("returns the hash from eth_getBlockByNumber(0x0, false)", async () => {
    const rpc = stubRpc(() => ({ hash: "0xgenesis1", number: "0x0" }));
    await expect(fetchGenesisHash(rpc, "http://node")).resolves.toBe(
      "0xgenesis1",
    );
  });

  it("passes block tag 0x0 and full=false", async () => {
    const seen: unknown[] = [];
    const rpc = stubRpc((_method, params) => {
      seen.push(params);
      return { hash: "0xgenesis1" };
    });
    await fetchGenesisHash(rpc, "http://node");
    expect(seen[0]).toEqual(["0x0", false]);
  });

  it("uses the eth_getBlockByNumber method", async () => {
    let method = "";
    const rpc = stubRpc((m) => {
      method = m;
      return { hash: "0xgenesis1" };
    });
    await fetchGenesisHash(rpc, "http://node");
    expect(method).toBe("eth_getBlockByNumber");
  });

  it("rejects when the block result is null (unknown block)", async () => {
    const rpc = stubRpc(() => null);
    await expect(fetchGenesisHash(rpc, "http://node")).rejects.toThrow(
      /no genesis block/,
    );
  });

  it("rejects when the block result has no hash field", async () => {
    const rpc = stubRpc(() => ({ number: "0x0" }));
    await expect(fetchGenesisHash(rpc, "http://node")).rejects.toThrow(
      /without a hash/,
    );
  });

  it("rejects when the block result's hash is not a string", async () => {
    const rpc = stubRpc(() => ({ hash: 12345 }));
    await expect(fetchGenesisHash(rpc, "http://node")).rejects.toThrow(
      /without a hash/,
    );
  });

  it("propagates transport errors (e.g. unreachable node)", async () => {
    const rpc: EthRpcClient = {
      async call() {
        throw new Error("connection refused");
      },
    };
    await expect(fetchGenesisHash(rpc, "http://node")).rejects.toThrow(
      "connection refused",
    );
  });
});
