import type { ContractEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { ContractPopover } from "./ContractPopover.js";

afterEach(cleanup);

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: `0x${"a".repeat(40)}`,
    chainType: "ethereum",
    nft: { symbol: "CVN" },
    ...overrides,
  };
}

function wrap(entity: ContractEntity, walletAddresses?: ReadonlySet<string>) {
  const anchorRef = { current: document.createElement("div") };
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <ContractPopover
          anchorRef={anchorRef}
          entity={entity}
          walletAddresses={walletAddresses}
        />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("ContractPopover issued NFT ledger (Issue #315)", () => {
  it("does not render the section when nftTokens is omitted (unobserved)", () => {
    wrap(contract({ nftTokens: undefined }));
    expect(screen.queryByText("発行済み NFT")).toBeNull();
  });

  it("shows the 'not yet issued' message for an empty ledger", () => {
    wrap(contract({ nftTokens: [] }));
    expect(screen.getByText("発行済み NFT")).toBeTruthy();
    expect(screen.getByText("まだ発行されていません")).toBeTruthy();
  });

  it("lists tokenId and the shortened owner address for each ledger entry", () => {
    const owner = `0x${"b".repeat(40)}`;
    wrap(contract({ nftTokens: [{ tokenId: "1", ownerAddress: owner }] }));
    const item = screen.getByTestId(
      `contract-popover-nft-${contract().address}-1`,
    );
    expect(item.textContent).toBe(`#1${owner.slice(0, 8)}…${owner.slice(-4)}`);
  });

  it("swaps in the matching wallet's own address casing for the owner", () => {
    const lower = `0x${"b".repeat(40)}`;
    const checksummed = `0x${"b".repeat(20)}${"B".repeat(20)}`;
    wrap(
      contract({ nftTokens: [{ tokenId: "1", ownerAddress: lower }] }),
      new Set([checksummed]),
    );
    const item = screen.getByTestId(
      `contract-popover-nft-${contract().address}-1`,
    );
    expect(item.textContent).toBe(
      `#1${checksummed.slice(0, 8)}…${checksummed.slice(-4)}`,
    );
  });
});
