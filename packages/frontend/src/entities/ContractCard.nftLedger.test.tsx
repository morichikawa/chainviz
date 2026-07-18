import type { ContractEntity } from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider } from "../side-panel/SidePanelContext.js";
import { ContractCard } from "./ContractCard.js";
import type { ContractFlowNode } from "./contractNode.js";
import { RibbonHoverProvider } from "./RibbonHoverContext.js";

afterEach(cleanup);

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: `0x${"c".repeat(40)}`,
    chainType: "ethereum",
    nft: { symbol: "CVNDEMO" },
    ...overrides,
  };
}

function data(
  overrides: Partial<ContractFlowNode["data"]> = {},
): ContractFlowNode["data"] {
  return {
    entity: contract(),
    activity: [],
    walletAddresses: new Set(),
    ...overrides,
  };
}

function renderCard(nodeData: ContractFlowNode["data"], lang: "ja" | "en" = "ja") {
  const props = { data: nodeData } as unknown as Parameters<typeof ContractCard>[0];
  return render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage={lang}>
        <GlossaryProvider glossary={{}}>
          <RibbonHoverProvider transactions={[]}>
            <SidePanelProvider>
              <ContractCard {...props} />
            </SidePanelProvider>
          </RibbonHoverProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
}

describe("ContractCard issued NFT ledger (Issue #315)", () => {
  it("does not render the section when nftTokens is omitted (unobserved)", () => {
    renderCard(data({ entity: contract({ nftTokens: undefined }) }));
    expect(
      screen.queryByTestId(`contract-nft-${contract().address}`),
    ).toBeNull();
  });

  it("shows the 'not yet issued' message when nftTokens is an empty array", () => {
    renderCard(data({ entity: contract({ nftTokens: [] }) }));
    expect(
      screen.getByTestId(`contract-nft-${contract().address}`),
    ).toBeTruthy();
    expect(screen.getByText("まだ発行されていません")).toBeTruthy();
  });

  it("shows a chip with tokenId and the raw owner address when no wallet matches", () => {
    const owner = `0x${"b".repeat(40)}`;
    renderCard(
      data({
        entity: contract({ nftTokens: [{ tokenId: "1", ownerAddress: owner }] }),
      }),
    );
    const chip = screen.getByTestId(
      `contract-nft-chip-${contract().address}-1`,
    );
    expect(chip.textContent).toBe(`#1 · ${owner.slice(0, 8)}…${owner.slice(-4)}`);
  });

  it("uses the matching wallet's own address casing for the owner label", () => {
    const lower = `0x${"b".repeat(40)}`;
    const checksummed = `0x${"b".repeat(20)}${"B".repeat(20)}`;
    renderCard(
      data({
        entity: contract({ nftTokens: [{ tokenId: "1", ownerAddress: lower }] }),
        walletAddresses: new Set([checksummed]),
      }),
    );
    const chip = screen.getByTestId(
      `contract-nft-chip-${contract().address}-1`,
    );
    expect(chip.textContent).toBe(
      `#1 · ${checksummed.slice(0, 8)}…${checksummed.slice(-4)}`,
    );
  });

  it("renders one chip per ledger entry", () => {
    const ownerA = `0x${"1".repeat(40)}`;
    const ownerB = `0x${"2".repeat(40)}`;
    renderCard(
      data({
        entity: contract({
          nftTokens: [
            { tokenId: "1", ownerAddress: ownerA },
            { tokenId: "2", ownerAddress: ownerB },
          ],
        }),
      }),
    );
    expect(
      screen.getByTestId(`contract-nft-chip-${contract().address}-1`),
    ).toBeTruthy();
    expect(
      screen.getByTestId(`contract-nft-chip-${contract().address}-2`),
    ).toBeTruthy();
  });

  it("shows the English 'not yet issued' message when the language is English", () => {
    renderCard(data({ entity: contract({ nftTokens: [] }) }), "en");
    expect(screen.getByText("None issued yet")).toBeTruthy();
  });
});
