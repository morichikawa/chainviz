import type { ContractEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { formatNftChipLabel, resolveWalletNftHoldings } from "./walletNftHoldings.js";

function nftContract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: `0x${"c".repeat(40)}`,
    chainType: "ethereum",
    nft: { symbol: "CVN" },
    ...overrides,
  };
}

describe("resolveWalletNftHoldings (Issue #315)", () => {
  it("returns an empty array when there are no contracts", () => {
    expect(resolveWalletNftHoldings("0xa", [])).toEqual([]);
  });

  it("returns an empty array when no contract's ledger matches the wallet", () => {
    const other = `0x${"1".repeat(40)}`;
    const contract = nftContract({
      nftTokens: [{ tokenId: "1", ownerAddress: other }],
    });
    expect(resolveWalletNftHoldings("0xa", [contract])).toEqual([]);
  });

  it("resolves a single holding from a matching ledger entry", () => {
    const wallet = `0x${"a".repeat(40)}`;
    const contract = nftContract({
      name: "ChainvizNFT",
      nftTokens: [{ tokenId: "1", ownerAddress: wallet }],
    });
    expect(resolveWalletNftHoldings(wallet, [contract])).toEqual([
      {
        contractAddress: contract.address,
        symbol: "CVN",
        contractName: "ChainvizNFT",
        tokenId: "1",
      },
    ]);
  });

  it("skips a contract that has nftTokens but no nft meta (not identified as an NFT contract)", () => {
    const wallet = `0x${"a".repeat(40)}`;
    const contract = nftContract({
      nft: undefined,
      nftTokens: [{ tokenId: "1", ownerAddress: wallet }],
    });
    expect(resolveWalletNftHoldings(wallet, [contract])).toEqual([]);
  });

  it("skips a contract that has nft meta but no nftTokens (unobserved ledger)", () => {
    const wallet = `0x${"a".repeat(40)}`;
    const contract = nftContract({ nftTokens: undefined });
    expect(resolveWalletNftHoldings(wallet, [contract])).toEqual([]);
  });

  it("matches ownerAddress case-insensitively (chain-side lowercase vs EIP-55 wallet)", () => {
    const lower = `0x${"a".repeat(40)}`;
    const upper = `0x${"A".repeat(40)}`;
    const contract = nftContract({
      nftTokens: [{ tokenId: "1", ownerAddress: lower }],
    });
    expect(resolveWalletNftHoldings(upper, [contract])).toEqual([
      {
        contractAddress: contract.address,
        symbol: "CVN",
        contractName: undefined,
        tokenId: "1",
      },
    ]);
  });

  it("aggregates matching holdings across multiple contracts", () => {
    const wallet = `0x${"a".repeat(40)}`;
    const contractA = nftContract({
      address: `0x${"1".repeat(40)}`,
      nftTokens: [{ tokenId: "1", ownerAddress: wallet }],
    });
    const contractB = nftContract({
      address: `0x${"2".repeat(40)}`,
      nftTokens: [{ tokenId: "1", ownerAddress: wallet }],
    });
    const result = resolveWalletNftHoldings(wallet, [contractA, contractB]);
    expect(result).toHaveLength(2);
    expect(result.map((h) => h.contractAddress)).toEqual([
      contractA.address,
      contractB.address,
    ]);
  });

  it("drops only the tokens owned by other addresses within the same ledger", () => {
    const wallet = `0x${"a".repeat(40)}`;
    const other = `0x${"b".repeat(40)}`;
    const contract = nftContract({
      nftTokens: [
        { tokenId: "1", ownerAddress: wallet },
        { tokenId: "2", ownerAddress: other },
        { tokenId: "3", ownerAddress: wallet },
      ],
    });
    const result = resolveWalletNftHoldings(wallet, [contract]);
    expect(result.map((h) => h.tokenId)).toEqual(["1", "3"]);
  });

  it("sorts results by contractAddress then by tokenId as a number (not lexicographically)", () => {
    const wallet = `0x${"a".repeat(40)}`;
    const contract = nftContract({
      // tokenId 10 が字句順だと "2" より前に来てしまう境界を確認する。
      nftTokens: [
        { tokenId: "10", ownerAddress: wallet },
        { tokenId: "2", ownerAddress: wallet },
        { tokenId: "1", ownerAddress: wallet },
      ],
    });
    const result = resolveWalletNftHoldings(wallet, [contract]);
    expect(result.map((h) => h.tokenId)).toEqual(["1", "2", "10"]);
  });

  it("sorts holdings from a contract iterated later before one iterated earlier, by address value", () => {
    // Map の走査順（宣言順）に依存せず、常に contractAddress 昇順にする
    // ことを確認する。
    const wallet = `0x${"a".repeat(40)}`;
    const contractZ = nftContract({
      address: `0x${"f".repeat(40)}`,
      nftTokens: [{ tokenId: "1", ownerAddress: wallet }],
    });
    const contractA = nftContract({
      address: `0x${"1".repeat(40)}`,
      nftTokens: [{ tokenId: "1", ownerAddress: wallet }],
    });
    const result = resolveWalletNftHoldings(wallet, [contractZ, contractA]);
    expect(result.map((h) => h.contractAddress)).toEqual([
      contractA.address,
      contractZ.address,
    ]);
  });

  it("falls back to a string comparison for a non-numeric tokenId (defensive, mirrors formatUnits)", () => {
    const wallet = `0x${"a".repeat(40)}`;
    const contract = nftContract({
      nftTokens: [
        { tokenId: "b-broken", ownerAddress: wallet },
        { tokenId: "a-broken", ownerAddress: wallet },
      ],
    });
    const result = resolveWalletNftHoldings(wallet, [contract]);
    expect(result.map((h) => h.tokenId)).toEqual(["a-broken", "b-broken"]);
  });

  it("leaves contractName undefined when the matched contract has no name", () => {
    const wallet = `0x${"a".repeat(40)}`;
    const contract = nftContract({
      name: undefined,
      nftTokens: [{ tokenId: "1", ownerAddress: wallet }],
    });
    expect(resolveWalletNftHoldings(wallet, [contract])[0]?.contractName).toBeUndefined();
  });
});

describe("formatNftChipLabel", () => {
  it("formats as 'SYMBOL #tokenId'", () => {
    expect(formatNftChipLabel({ symbol: "CVN", tokenId: "1" })).toBe("CVN #1");
  });
});
