import type { ContractEntity, WalletEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { WalletPopover } from "./WalletPopover.js";

afterEach(cleanup);

function wallet(overrides: Partial<WalletEntity> = {}): WalletEntity {
  return {
    kind: "wallet",
    address: `0x${"a".repeat(40)}`,
    chainType: "ethereum",
    balance: (3n * 10n ** 18n).toString(),
    nonce: 5,
    isSmartAccount: false,
    ownerWorkbenchId: "workbench-alice",
    recentTxHashes: [],
    ...overrides,
  };
}

function nftContract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: `0x${"c".repeat(40)}`,
    chainType: "ethereum",
    nft: { symbol: "CVN" },
    ...overrides,
  };
}

function wrap(contractsByAddress?: ReadonlyMap<string, ContractEntity>) {
  const anchorRef = { current: document.createElement("div") };
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <WalletPopover
          anchorRef={anchorRef}
          entity={wallet()}
          transactions={[]}
          contractsByAddress={contractsByAddress}
        />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("WalletPopover NFT holdings (Issue #315)", () => {
  it("shows no NFT row when no ledger entry matches this wallet", () => {
    wrap();
    expect(screen.queryByText("保有 NFT")).toBeNull();
  });

  it("lists the contract name (with shortened address) and 'SYMBOL #tokenId' for a matching holding", () => {
    const nftAddress = `0x${"d".repeat(40)}`;
    wrap(
      new Map([
        [
          nftAddress,
          nftContract({
            address: nftAddress,
            name: "ChainvizNFT",
            nftTokens: [{ tokenId: "1", ownerAddress: wallet().address }],
          }),
        ],
      ]),
    );
    const item = screen.getByTestId(
      `wallet-popover-nft-${wallet().address}-${nftAddress}-1`,
    );
    expect(item.textContent).toBe(
      `ChainvizNFT (${nftAddress.slice(0, 8)}…${nftAddress.slice(-4)})CVN #1`,
    );
  });

  it("omits a ledger entry owned by a different address", () => {
    const nftAddress = `0x${"d".repeat(40)}`;
    const other = `0x${"b".repeat(40)}`;
    wrap(
      new Map([
        [
          nftAddress,
          nftContract({
            address: nftAddress,
            nftTokens: [{ tokenId: "1", ownerAddress: other }],
          }),
        ],
      ]),
    );
    expect(screen.queryByText("保有 NFT")).toBeNull();
    expect(
      screen.queryByTestId(`wallet-popover-nft-${wallet().address}-${nftAddress}-1`),
    ).toBeNull();
  });
});
