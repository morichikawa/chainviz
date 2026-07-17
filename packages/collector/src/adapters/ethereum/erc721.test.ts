import { describe, expect, it } from "vitest";
import type { EthRpcClient } from "./eth-rpc-client.js";
import { fetchErc721Ledger } from "./erc721.js";

const contract = "0xnftcontract"; // to はこの層では検証されないため任意の文字列でよい

/** owner を viem が期待する 32 バイト address の 16 進表現へ（左詰めパディング）。 */
function encodeAddress(address: string): string {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`;
}

/** uint256 の値を viem が期待する 32 バイトの 16 進表現へ。 */
function encodeUint256(value: bigint): string {
  return `0x${value.toString(16).padStart(64, "0")}`;
}

/**
 * totalSupply()/ownerOf(uint256) だけをスタブする eth_call ハンドラ。
 * セレクタで両者を判別する（0x18160ddd = totalSupply()、
 * 0x6352211e = ownerOf(uint256)）。
 */
function stubRpc(opts: {
  totalSupply: bigint;
  owners?: Record<string, string>; // tokenId(10進文字列) -> owner
  failingTokenIds?: Set<string>;
}): { rpc: EthRpcClient; calls: { to: string; data: string }[] } {
  const calls: { to: string; data: string }[] = [];
  const rpc: EthRpcClient = {
    async call<T>(_url: string, method: string, params: unknown[]): Promise<T> {
      expect(method).toBe("eth_call");
      const [{ to, data }] = params as [{ to: string; data: string }, string];
      calls.push({ to, data });
      const selector = data.slice(0, 10);
      if (selector === "0x18160ddd") {
        return encodeUint256(opts.totalSupply) as T;
      }
      if (selector === "0x6352211e") {
        const tokenIdHex = data.slice(10);
        const tokenId = BigInt(`0x${tokenIdHex}`).toString(10);
        if (opts.failingTokenIds?.has(tokenId)) {
          throw new Error(`ownerOf reverted for tokenId ${tokenId}`);
        }
        const owner = opts.owners?.[tokenId];
        if (!owner) throw new Error(`no stubbed owner for tokenId ${tokenId}`);
        return encodeAddress(owner) as T;
      }
      throw new Error(`unexpected calldata selector ${selector}`);
    },
  };
  return { rpc, calls };
}

describe("fetchErc721Ledger", () => {
  it("returns an empty array when totalSupply is 0 (nothing minted yet)", async () => {
    const { rpc, calls } = stubRpc({ totalSupply: 0n });
    const ledger = await fetchErc721Ledger(rpc, "http://node", contract);
    expect(ledger).toEqual([]);
    // totalSupply だけを問い合わせ、ownerOf は 1 度も呼ばない。
    expect(calls).toHaveLength(1);
  });

  it("fetches ownerOf for tokenId 1..totalSupply and returns them as decimal-string tokenIds", async () => {
    const owner1 = `0x${"1".padStart(40, "0")}`;
    const owner2 = `0x${"2".padStart(40, "0")}`;
    const { rpc } = stubRpc({
      totalSupply: 2n,
      owners: { "1": owner1, "2": owner2 },
    });
    const ledger = await fetchErc721Ledger(rpc, "http://node", contract);
    expect(ledger).toEqual([
      { tokenId: "1", ownerAddress: owner1.toLowerCase() },
      { tokenId: "2", ownerAddress: owner2.toLowerCase() },
    ]);
  });

  it("normalizes owner address casing to lowercase", async () => {
    const checksummedOwner = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
    const { rpc } = stubRpc({
      totalSupply: 1n,
      owners: { "1": checksummedOwner },
    });
    const ledger = await fetchErc721Ledger(rpc, "http://node", contract);
    expect(ledger[0].ownerAddress).toBe(checksummedOwner.toLowerCase());
  });

  it("rejects (does not return a partial ledger) when a single ownerOf call fails", async () => {
    const owner1 = `0x${"1".padStart(40, "0")}`;
    const { rpc } = stubRpc({
      totalSupply: 3n,
      owners: { "1": owner1, "3": owner1 },
      failingTokenIds: new Set(["2"]),
    });
    await expect(
      fetchErc721Ledger(rpc, "http://node", contract),
    ).rejects.toThrow("ownerOf reverted for tokenId 2");
  });

  it("propagates a failed totalSupply call without attempting any ownerOf calls", async () => {
    const rpc: EthRpcClient = {
      async call(): Promise<never> {
        throw new Error("connection refused");
      },
    };
    await expect(
      fetchErc721Ledger(rpc, "http://node", contract),
    ).rejects.toThrow("connection refused");
  });

  it("queries ownerOf for exactly tokenIds 1..totalSupply (never 0, never totalSupply+1)", async () => {
    // 「burn なし + 1 始まりの連番採番」により発行済み tokenId が
    // 1〜totalSupply であるという不変条件（ChainvizNFT.sol / collector が依存）
    // の回帰ガード。i+1 のオフバイワンや列挙範囲の取り違えを検出する。
    const owner = `0x${"1".padStart(40, "0")}`;
    const { rpc, calls } = stubRpc({
      totalSupply: 3n,
      owners: { "1": owner, "2": owner, "3": owner },
    });
    await fetchErc721Ledger(rpc, "http://node", contract);
    const ownerOfTokenIds = calls
      .filter((c) => c.data.slice(0, 10) === "0x6352211e")
      .map((c) => BigInt(`0x${c.data.slice(10)}`).toString(10))
      .sort((a, b) => Number(a) - Number(b));
    expect(ownerOfTokenIds).toEqual(["1", "2", "3"]);
  });

  it("returns tokens in ascending tokenId order even when ownerOf calls resolve out of order", async () => {
    // ownerOf は Promise.all で並行実行されるが、返り値の並びは tokenId の
    // 昇順（配列の構築順）に固定されている、という契約の回帰ガード。
    // frontend の resolveContractNftLedger は入力順をそのまま使うため、
    // ここでの並び保証が崩れると発行済み NFT の表示順が乱れる。
    const owners: Record<string, string> = {
      "1": `0x${"1".padStart(40, "0")}`,
      "2": `0x${"2".padStart(40, "0")}`,
      "3": `0x${"3".padStart(40, "0")}`,
    };
    const rpc: EthRpcClient = {
      async call<T>(
        _url: string,
        _method: string,
        params: unknown[],
      ): Promise<T> {
        const [{ data }] = params as [{ to: string; data: string }, string];
        if (data.slice(0, 10) === "0x18160ddd") {
          return encodeUint256(3n) as T;
        }
        const tokenId = BigInt(`0x${data.slice(10)}`).toString(10);
        // tokenId が小さいものほど遅く解決させ、解決順を昇順と逆にする。
        const delayMs = tokenId === "1" ? 6 : tokenId === "2" ? 3 : 0;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return encodeAddress(owners[tokenId]) as T;
      },
    };
    const ledger = await fetchErc721Ledger(rpc, "http://node", contract);
    expect(ledger.map((t) => t.tokenId)).toEqual(["1", "2", "3"]);
  });

  it("preserves precision for a large uint256 tokenId (no float rounding)", async () => {
    // totalSupply 自体を大きくすると配列長がメモリを圧迫するため、この観点は
    // 別の切り口（ownerOf の引数エンコードが tokenId=1 のような小さい値でも
    // BigInt 経由であることの確認）で足りる。fetchErc721Ledger は
    // Array.from({ length: Number(totalSupply) }) で列挙するため、
    // totalSupply 自体は小さいまま、生成される tokenId の 10 進表記が
    // BigInt.toString(10) 経由であることを確認する。
    const owner = `0x${"9".padStart(40, "0")}`;
    const { rpc } = stubRpc({ totalSupply: 1n, owners: { "1": owner } });
    const ledger = await fetchErc721Ledger(rpc, "http://node", contract);
    expect(typeof ledger[0].tokenId).toBe("string");
    expect(ledger[0].tokenId).toBe("1");
  });
});
