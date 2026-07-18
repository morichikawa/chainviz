import type { ContractEntity, WalletEntity } from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { RibbonHoverProvider } from "./RibbonHoverContext.js";
import { WalletCard } from "./WalletCard.js";
import type { WalletFlowNode } from "./walletNode.js";

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
    nft: { symbol: "CVNDEMO" },
    ...overrides,
  };
}

function data(overrides: Partial<WalletFlowNode["data"]> = {}): WalletFlowNode["data"] {
  return {
    entity: wallet(),
    transactions: [],
    popoverTransactions: [],
    settlingHashes: [],
    ownerPresent: true,
    contractsByAddress: new Map(),
    ...overrides,
  };
}

function renderCard(nodeData: WalletFlowNode["data"]) {
  const props = { data: nodeData } as unknown as Parameters<typeof WalletCard>[0];
  render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <RibbonHoverProvider transactions={[]}>
            <WalletCard {...props} />
          </RibbonHoverProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
}

describe("WalletCard NFT holdings (Issue #315)", () => {
  it("does not render the NFT section when no contract's ledger matches this wallet", () => {
    renderCard(data());
    expect(screen.queryByTestId(`wallet-nft-${wallet().address}`)).toBeNull();
  });

  it("shows a 'SYMBOL #tokenId' chip for a matching ledger entry", () => {
    const nftAddress = `0x${"d".repeat(40)}`;
    renderCard(
      data({
        contractsByAddress: new Map([
          [
            nftAddress,
            nftContract({
              address: nftAddress,
              name: "ChainvizNFT",
              nftTokens: [{ tokenId: "1", ownerAddress: wallet().address }],
            }),
          ],
        ]),
      }),
    );
    const chip = screen.getByTestId(
      `wallet-nft-chip-${wallet().address}-${nftAddress}-1`,
    );
    expect(chip.textContent).toBe("CVNDEMO #1");
  });

  it("omits an NFT owned by a different address", () => {
    const nftAddress = `0x${"d".repeat(40)}`;
    const otherOwner = `0x${"b".repeat(40)}`;
    renderCard(
      data({
        contractsByAddress: new Map([
          [
            nftAddress,
            nftContract({
              address: nftAddress,
              nftTokens: [{ tokenId: "1", ownerAddress: otherOwner }],
            }),
          ],
        ]),
      }),
    );
    expect(screen.queryByTestId(`wallet-nft-${wallet().address}`)).toBeNull();
  });

  it("shows multiple chips for multiple holdings across contracts", () => {
    const addressA = `0x${"1".repeat(40)}`;
    const addressB = `0x${"2".repeat(40)}`;
    renderCard(
      data({
        contractsByAddress: new Map([
          [
            addressA,
            nftContract({
              address: addressA,
              nftTokens: [{ tokenId: "1", ownerAddress: wallet().address }],
            }),
          ],
          [
            addressB,
            nftContract({
              address: addressB,
              nftTokens: [{ tokenId: "5", ownerAddress: wallet().address }],
            }),
          ],
        ]),
      }),
    );
    expect(
      screen.getByTestId(`wallet-nft-chip-${wallet().address}-${addressA}-1`),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`wallet-nft-chip-${wallet().address}-${addressB}-5`),
    ).toBeTruthy();
  });

  it("uses the contract name (with shortened address) as the chip's title, falling back to 'unknown contract'", () => {
    const nftAddress = `0x${"d".repeat(40)}`;
    renderCard(
      data({
        contractsByAddress: new Map([
          [
            nftAddress,
            nftContract({
              address: nftAddress,
              name: undefined,
              nftTokens: [{ tokenId: "1", ownerAddress: wallet().address }],
            }),
          ],
        ]),
      }),
    );
    const chip = screen.getByTestId(
      `wallet-nft-chip-${wallet().address}-${nftAddress}-1`,
    );
    expect(chip.title).toContain("未知のコントラクト");
  });
});
