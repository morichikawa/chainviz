import type { ContractEntity, TokenBalance } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  formatTokenContractLabel,
  resolveWalletTokenBalances,
} from "./walletTokenBalances.js";

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: `0x${"c".repeat(40)}`,
    chainType: "ethereum",
    ...overrides,
  };
}

describe("resolveWalletTokenBalances (ARCHITECTURE.md §6.7)", () => {
  it("returns an empty array when tokenBalances is undefined", () => {
    expect(resolveWalletTokenBalances(undefined, new Map())).toEqual([]);
  });

  it("returns an empty array when tokenBalances is an empty array", () => {
    expect(resolveWalletTokenBalances([], new Map())).toEqual([]);
  });

  it("resolves a balance against a matching ContractEntity with token metadata", () => {
    const tokenAddress = `0x${"a".repeat(40)}`;
    const byAddress = new Map([
      [
        tokenAddress,
        contract({
          address: tokenAddress,
          name: "ChainvizToken",
          token: { symbol: "CVZ", decimals: 18 },
        }),
      ],
    ]);
    const balances: TokenBalance[] = [
      { contractAddress: tokenAddress, amount: (5n * 10n ** 18n).toString() },
    ];
    expect(resolveWalletTokenBalances(balances, byAddress)).toEqual([
      {
        contractAddress: tokenAddress,
        symbol: "CVZ",
        contractName: "ChainvizToken",
        formatted: "5.0000",
      },
    ]);
  });

  it("omits a balance whose ContractEntity has not been observed yet (dangling guard)", () => {
    const untrackedAddress = `0x${"d".repeat(40)}`;
    const balances: TokenBalance[] = [
      { contractAddress: untrackedAddress, amount: "1000" },
    ];
    expect(resolveWalletTokenBalances(balances, new Map())).toEqual([]);
  });

  it("omits a balance whose matched ContractEntity lacks token metadata", () => {
    const nonTokenAddress = `0x${"e".repeat(40)}`;
    const byAddress = new Map([
      [nonTokenAddress, contract({ address: nonTokenAddress, name: "Counter" })],
    ]);
    const balances: TokenBalance[] = [
      { contractAddress: nonTokenAddress, amount: "1000" },
    ];
    expect(resolveWalletTokenBalances(balances, byAddress)).toEqual([]);
  });

  it("resolves multiple balances, dropping only the unresolvable ones", () => {
    const knownAddress = `0x${"a".repeat(40)}`;
    const unknownAddress = `0x${"f".repeat(40)}`;
    const byAddress = new Map([
      [
        knownAddress,
        contract({
          address: knownAddress,
          name: "ChainvizToken",
          token: { symbol: "CVZ", decimals: 18 },
        }),
      ],
    ]);
    const balances: TokenBalance[] = [
      { contractAddress: knownAddress, amount: (10n ** 18n).toString() },
      { contractAddress: unknownAddress, amount: "999" },
    ];
    const result = resolveWalletTokenBalances(balances, byAddress);
    expect(result).toHaveLength(1);
    expect(result[0]?.contractAddress).toBe(knownAddress);
  });

  it("matches contractAddress case-sensitively, dropping a balance that differs only in casing", () => {
    // The App builds contractsByAddress keyed by ContractEntity.address verbatim
    // (no lowercasing), and this resolver does a plain Map.get. Matching therefore
    // relies on the collector emitting the SAME casing on both sides (both
    // lowercase in practice — see Issue #161). This test pins that assumption:
    // a balance whose contractAddress differs only in casing is treated as
    // dangling and dropped, so any future divergence surfaces as a failure here.
    const lower = `0x${"a".repeat(40)}`;
    const upper = `0x${"A".repeat(40)}`;
    const byAddress = new Map([
      [
        lower,
        contract({
          address: lower,
          name: "ChainvizToken",
          token: { symbol: "CVZ", decimals: 18 },
        }),
      ],
    ]);
    const balances: TokenBalance[] = [
      { contractAddress: upper, amount: (10n ** 18n).toString() },
    ];
    expect(resolveWalletTokenBalances(balances, byAddress)).toEqual([]);
  });

  it("preserves the input order of resolved balances", () => {
    const first = `0x${"1".repeat(40)}`;
    const second = `0x${"2".repeat(40)}`;
    const third = `0x${"3".repeat(40)}`;
    const byAddress = new Map([
      [first, contract({ address: first, name: "TokenA", token: { symbol: "A", decimals: 18 } })],
      [second, contract({ address: second, name: "TokenB", token: { symbol: "B", decimals: 18 } })],
      [third, contract({ address: third, name: "TokenC", token: { symbol: "C", decimals: 18 } })],
    ]);
    // Supplied deliberately out of map-insertion order.
    const balances: TokenBalance[] = [
      { contractAddress: third, amount: (10n ** 18n).toString() },
      { contractAddress: first, amount: (10n ** 18n).toString() },
      { contractAddress: second, amount: (10n ** 18n).toString() },
    ];
    const result = resolveWalletTokenBalances(balances, byAddress);
    expect(result.map((r) => r.symbol)).toEqual(["C", "A", "B"]);
  });

  it("formats a 0-decimals token without a decimal point", () => {
    const tokenAddress = `0x${"9".repeat(40)}`;
    const byAddress = new Map([
      [
        tokenAddress,
        contract({
          address: tokenAddress,
          name: "PointToken",
          token: { symbol: "PT", decimals: 0 },
        }),
      ],
    ]);
    const balances: TokenBalance[] = [
      { contractAddress: tokenAddress, amount: "42" },
    ];
    expect(resolveWalletTokenBalances(balances, byAddress)[0]?.formatted).toBe(
      "42",
    );
  });

  it("returns an empty array when the contract map is empty but balances are present", () => {
    const balances: TokenBalance[] = [
      { contractAddress: `0x${"a".repeat(40)}`, amount: "1000" },
      { contractAddress: `0x${"b".repeat(40)}`, amount: "2000" },
    ];
    expect(resolveWalletTokenBalances(balances, new Map())).toEqual([]);
  });

  it("leaves contractName undefined when the matched ContractEntity has no name (uncataloged but somehow has token metadata)", () => {
    const tokenAddress = `0x${"b".repeat(40)}`;
    const byAddress = new Map([
      [
        tokenAddress,
        contract({ address: tokenAddress, token: { symbol: "CVZ", decimals: 18 } }),
      ],
    ]);
    const balances: TokenBalance[] = [
      { contractAddress: tokenAddress, amount: "0" },
    ];
    const result = resolveWalletTokenBalances(balances, byAddress);
    expect(result[0]?.contractName).toBeUndefined();
  });
});

describe("formatTokenContractLabel (Issue #218 派生: 同名トークンの区別)", () => {
  const address = `0x${"a".repeat(40)}`;

  it("combines the contract name with the shortened address", () => {
    expect(
      formatTokenContractLabel(
        { contractName: "ChainvizToken", contractAddress: address },
        "Unknown contract",
      ),
    ).toBe(`ChainvizToken (${address.slice(0, 8)}…${address.slice(-4)})`);
  });

  it("falls back to the given unknown label when contractName is absent", () => {
    expect(
      formatTokenContractLabel(
        { contractName: undefined, contractAddress: address },
        "Unknown contract",
      ),
    ).toBe(`Unknown contract (${address.slice(0, 8)}…${address.slice(-4)})`);
  });

  it("distinguishes two same-named tokens by their address", () => {
    const other = `0x${"b".repeat(40)}`;
    const first = formatTokenContractLabel(
      { contractName: "ChainvizToken", contractAddress: address },
      "Unknown contract",
    );
    const second = formatTokenContractLabel(
      { contractName: "ChainvizToken", contractAddress: other },
      "Unknown contract",
    );
    expect(first).not.toBe(second);
  });
});
