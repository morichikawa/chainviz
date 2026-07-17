import type { NftToken } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { resolveContractNftLedger } from "./contractNftLedger.js";

describe("resolveContractNftLedger (Issue #315)", () => {
  it("returns an empty array when nftTokens is undefined", () => {
    expect(resolveContractNftLedger(undefined, [])).toEqual([]);
  });

  it("returns an empty array when nftTokens is an empty array", () => {
    expect(resolveContractNftLedger([], [])).toEqual([]);
  });

  it("preserves the raw ownerAddress when no wallet matches", () => {
    const owner = `0x${"a".repeat(40)}`;
    const tokens: NftToken[] = [{ tokenId: "1", ownerAddress: owner }];
    expect(resolveContractNftLedger(tokens, [])).toEqual([
      { tokenId: "1", ownerAddress: owner },
    ]);
  });

  it("swaps in the matching wallet's own address casing (case-insensitive match)", () => {
    const lower = `0x${"a".repeat(40)}`;
    const checksummed = `0x${"a".repeat(20)}${"A".repeat(20)}`;
    const tokens: NftToken[] = [{ tokenId: "1", ownerAddress: lower }];
    expect(
      resolveContractNftLedger(tokens, [checksummed]),
    ).toEqual([{ tokenId: "1", ownerAddress: checksummed }]);
  });

  it("uses the last wallet entry's casing when two entries differ only in case (buildLowerCaseIndex last-wins)", () => {
    // buildLowerCaseIndex は同一アドレスの表記揺れを後勝ちで畳む
    // （addressCasing.ts の doc コメント）。通常この重複は起きないが、
    // 万一起きても例外にならず決定的（最後の表記が採用される）である
    // ことを固定する防御的テスト。
    const lower = `0x${"a".repeat(40)}`;
    const upper = `0x${"A".repeat(40)}`;
    const tokens: NftToken[] = [{ tokenId: "1", ownerAddress: lower }];
    expect(resolveContractNftLedger(tokens, [lower, upper])).toEqual([
      { tokenId: "1", ownerAddress: upper },
    ]);
  });

  it("preserves input order (collector guarantees tokenId ascending)", () => {
    const owner = `0x${"a".repeat(40)}`;
    const tokens: NftToken[] = [
      { tokenId: "3", ownerAddress: owner },
      { tokenId: "1", ownerAddress: owner },
      { tokenId: "2", ownerAddress: owner },
    ];
    const result = resolveContractNftLedger(tokens, [owner]);
    expect(result.map((t) => t.tokenId)).toEqual(["3", "1", "2"]);
  });

  it("resolves each token independently against its own owner", () => {
    const walletA = `0x${"a".repeat(40)}`;
    const walletB = `0x${"b".repeat(40)}`;
    const untracked = `0x${"c".repeat(40)}`;
    const tokens: NftToken[] = [
      { tokenId: "1", ownerAddress: walletA },
      { tokenId: "2", ownerAddress: untracked },
      { tokenId: "3", ownerAddress: walletB },
    ];
    const result = resolveContractNftLedger(tokens, [walletA, walletB]);
    expect(result).toEqual([
      { tokenId: "1", ownerAddress: walletA },
      { tokenId: "2", ownerAddress: untracked },
      { tokenId: "3", ownerAddress: walletB },
    ]);
  });
});
