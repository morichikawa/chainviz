import { describe, expect, it } from "vitest";
import type { EthRpcClient } from "./eth-rpc-client.js";
import { fetchErc20Balance } from "./erc20.js";

// balanceOf の引数は viem が ABI エンコードする際に有効な 20 バイトアドレス
// でなければならない（EIP-55 チェックサム検証。数字のみの表記は検証対象外
// なので常に有効）。padStart で 40 桁ちょうどの 16 進文字列にする。
const wallet = `0x${"1".padStart(40, "0")}`;
const token = "0xtokencontract"; // to はこの層では検証されないため任意の文字列でよい

/** eth_call をスタブし、渡された data（calldata）を検査できるようにする。 */
function stubRpc(
  handler: (to: string, data: string) => string,
): { rpc: EthRpcClient; calls: { url: string; to: string; data: string }[] } {
  const calls: { url: string; to: string; data: string }[] = [];
  const rpc: EthRpcClient = {
    async call<T>(url: string, method: string, params: unknown[]): Promise<T> {
      expect(method).toBe("eth_call");
      const [{ to, data }] = params as [{ to: string; data: string }, string];
      calls.push({ url, to, data });
      return handler(to, data) as T;
    },
  };
  return { rpc, calls };
}

/** balanceOf の戻り値を viem が期待する 32 バイト uint256 の 16 進表現へ。 */
function encodeUint256(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

describe("fetchErc20Balance", () => {
  it("calls eth_call with the balanceOf selector and returns a decimal string", async () => {
    const { rpc, calls } = stubRpc(() => encodeUint256(123456789012345678901234n));
    const balance = await fetchErc20Balance(rpc, "http://node", token, wallet);
    expect(balance).toBe("123456789012345678901234");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("http://node");
    expect(calls[0].to).toBe(token);
    // 0x70a08231 は balanceOf(address) の関数セレクタ（keccak256 の先頭 4 バイト）。
    expect(calls[0].data.startsWith("0x70a08231")).toBe(true);
  });

  it("returns '0' for a zero balance", async () => {
    const { rpc } = stubRpc(() => encodeUint256(0n));
    expect(await fetchErc20Balance(rpc, "http://node", token, wallet)).toBe("0");
  });

  it("preserves full precision for a uint256-max balance (no float rounding)", async () => {
    // ERC20 の残高は uint256（2^256 - 1 が上限）。number では 2^53 を超えると
    // 桁落ちするため、bigint 経由で 10 進文字列へ変換して精度を保つことを、
    // 表現可能な最大値で確認する（78 桁）。
    const uint256Max = 2n ** 256n - 1n;
    const { rpc } = stubRpc(() => encodeUint256(uint256Max));
    const balance = await fetchErc20Balance(rpc, "http://node", token, wallet);
    expect(balance).toBe(uint256Max.toString(10));
    expect(balance).toBe(
      "115792089237316195423570985008687907853269984665640564039457584007913129639935",
    );
  });

  it("keeps precision for a large but non-round balance near 18-decimal token scale", async () => {
    // 例: 1_234_567.890123456789012345 トークン（18 桁小数）相当の最小単位値。
    // number 化すると必ず桁落ちする大きさ。
    const raw = 1234567890123456789012345n;
    const { rpc } = stubRpc(() => encodeUint256(raw));
    expect(await fetchErc20Balance(rpc, "http://node", token, wallet)).toBe(
      raw.toString(10),
    );
  });

  it("encodes the wallet address (not the token address) as the balanceOf argument", async () => {
    const { rpc, calls } = stubRpc(() => encodeUint256(1n));
    await fetchErc20Balance(rpc, "http://node", token, wallet);
    // calldata = セレクタ(4 バイト) + アドレス引数(32 バイトへ左詰めパディング)。
    const argument = calls[0].data.slice(10);
    expect(argument.toLowerCase()).toBe(
      wallet.slice(2).toLowerCase().padStart(64, "0"),
    );
  });

  it("propagates a JSON-RPC error (e.g. unreachable node) without swallowing it", async () => {
    const rpc: EthRpcClient = {
      async call(): Promise<never> {
        throw new Error("connection refused");
      },
    };
    await expect(
      fetchErc20Balance(rpc, "http://node", token, wallet),
    ).rejects.toThrow("connection refused");
  });
});
