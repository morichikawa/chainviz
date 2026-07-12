import type { ContractEntity, TransactionEntity, WalletEntity } from "@chainviz/shared";
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

function tx(
  hash: string,
  status: TransactionEntity["status"],
): TransactionEntity {
  return { kind: "transaction", hash, from: "0xa", to: "0xb", status };
}

function renderCard(data: WalletFlowNode["data"]) {
  const props = { data } as unknown as Parameters<typeof WalletCard>[0];
  render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          {/* Issue #298: WalletCard は RibbonHoverContext を読むため、
              テストでも Provider 配下でレンダーする必要がある。 */}
          <RibbonHoverProvider transactions={[]}>
            <WalletCard {...props} />
          </RibbonHoverProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
}

function data(overrides: Partial<WalletFlowNode["data"]> = {}): WalletFlowNode["data"] {
  return {
    entity: wallet(),
    transactions: [],
    settlingHashes: [],
    ownerPresent: true,
    contractsByAddress: new Map(),
    ...overrides,
  };
}

describe("WalletCard", () => {
  it("shows the shortened address and ether balance", () => {
    renderCard(data());
    expect(screen.getByText("0xaaaaaa…aaaa")).toBeTruthy();
    expect(screen.getByText(/3\.0000 ETH/)).toBeTruthy();
  });

  it("renders a tx chip carrying the status as a data attribute", () => {
    const t = tx("0xdeadbeef00000000", "pending");
    renderCard(data({ entity: wallet({ recentTxHashes: [t.hash] }), transactions: [t] }));
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.getAttribute("data-status")).toBe("pending");
  });

  it("adds the settling class to a tx currently in the settling set", () => {
    const t = tx("0xabc1230000000000", "included");
    renderCard(
      data({
        entity: wallet({ recentTxHashes: [t.hash] }),
        transactions: [t],
        settlingHashes: [t.hash],
      }),
    );
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.className).toContain("is-settling");
  });

  it("shows an owner-deleted badge when the owner is absent", () => {
    renderCard(
      data({
        entity: wallet({ ownerWorkbenchId: null }),
        ownerPresent: false,
      }),
    );
    expect(screen.getByTestId(`wallet-orphan-${wallet().address}`)).toBeTruthy();
  });

  it("does not show the owner-deleted badge when the owner is present", () => {
    renderCard(data({ ownerPresent: true }));
    expect(
      screen.queryByTestId(`wallet-orphan-${wallet().address}`),
    ).toBeNull();
  });

  it("labels a smart account differently from an EOA", () => {
    renderCard(data({ entity: wallet({ isSmartAccount: true }) }));
    expect(screen.getByText("スマートアカウント")).toBeTruthy();
  });
});

describe("WalletCard token balances (ARCHITECTURE.md §6.7)", () => {
  function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
    return {
      kind: "contract",
      address: `0x${"c".repeat(40)}`,
      chainType: "ethereum",
      ...overrides,
    };
  }

  it("does not render the token balances section when tokenBalances is absent", () => {
    renderCard(data());
    expect(
      screen.queryByTestId(`wallet-tokens-${wallet().address}`),
    ).toBeNull();
  });

  it("does not render the token balances section when tokenBalances is empty", () => {
    renderCard(data({ entity: wallet({ tokenBalances: [] }) }));
    expect(
      screen.queryByTestId(`wallet-tokens-${wallet().address}`),
    ).toBeNull();
  });

  it("shows a formatted token balance chip when the contract is resolvable", () => {
    const tokenAddress = `0x${"d".repeat(40)}`;
    renderCard(
      data({
        entity: wallet({
          tokenBalances: [
            { contractAddress: tokenAddress, amount: (5n * 10n ** 18n).toString() },
          ],
        }),
        contractsByAddress: new Map([
          [
            tokenAddress,
            contract({
              address: tokenAddress,
              name: "ChainvizToken",
              token: { symbol: "CVZ", decimals: 18 },
            }),
          ],
        ]),
      }),
    );
    const chip = screen.getByTestId(
      `wallet-token-chip-${wallet().address}-${tokenAddress}`,
    );
    expect(chip.textContent).toBe("5.0000 CVZ");
  });

  it("distinguishes two same-named token contracts by address in the chip title (Issue #218 派生)", () => {
    const addressA = `0x${"d".repeat(40)}`;
    const addressB = `0x${"e".repeat(40)}`;
    renderCard(
      data({
        entity: wallet({
          tokenBalances: [
            { contractAddress: addressA, amount: "0" },
            { contractAddress: addressB, amount: "0" },
          ],
        }),
        contractsByAddress: new Map([
          [
            addressA,
            contract({
              address: addressA,
              name: "ChainvizToken",
              token: { symbol: "CVZ", decimals: 18 },
            }),
          ],
          [
            addressB,
            contract({
              address: addressB,
              name: "ChainvizToken",
              token: { symbol: "CVZ", decimals: 18 },
            }),
          ],
        ]),
      }),
    );
    const chipA = screen.getByTestId(
      `wallet-token-chip-${wallet().address}-${addressA}`,
    );
    const chipB = screen.getByTestId(
      `wallet-token-chip-${wallet().address}-${addressB}`,
    );
    expect(chipA.title).not.toBe(chipB.title);
    expect(chipA.title).toContain("ChainvizToken");
  });

  it("does not render a chip for a tokenBalance whose ContractEntity is unresolved (dangling guard)", () => {
    const tokenAddress = `0x${"d".repeat(40)}`;
    renderCard(
      data({
        entity: wallet({
          tokenBalances: [{ contractAddress: tokenAddress, amount: "1000" }],
        }),
        contractsByAddress: new Map(),
      }),
    );
    expect(
      screen.queryByTestId(`wallet-tokens-${wallet().address}`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`wallet-token-chip-${wallet().address}-${tokenAddress}`),
    ).toBeNull();
  });
});

describe("WalletCard tx chip label priority (ARCHITECTURE.md §6.6)", () => {
  it("prefers the decoded function name over the tx hash", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xcall00000000000000000000000000000000000000000000000000000000",
      from: "0xa",
      to: "0xtoken",
      status: "included",
      contractCall: { contractAddress: "0xtoken", functionName: "transfer" },
    };
    renderCard(
      data({ entity: wallet({ recentTxHashes: [t.hash] }), transactions: [t] }),
    );
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.textContent).toBe("transfer");
    expect(chip.getAttribute("data-label-kind")).toBe("function");
  });

  it("labels a deploy tx (createdContractAddress) as 'デプロイ' when no function name is decoded", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xdeploy0000000000000000000000000000000000000000000000000000000",
      from: "0xa",
      to: null,
      status: "included",
      createdContractAddress: "0xnewcontract",
    };
    renderCard(
      data({ entity: wallet({ recentTxHashes: [t.hash] }), transactions: [t] }),
    );
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.textContent).toBe("デプロイ");
    expect(chip.getAttribute("data-label-kind")).toBe("deploy");
  });

  it("falls back to a shortened rawFunctionId when the call cannot be decoded", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xraw000000000000000000000000000000000000000000000000000000000",
      from: "0xa",
      to: "0xunknown",
      status: "included",
      contractCall: { contractAddress: "0xunknown", rawFunctionId: "0xa9059cbb" },
    };
    renderCard(
      data({ entity: wallet({ recentTxHashes: [t.hash] }), transactions: [t] }),
    );
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.textContent).toBe("0xa9059cbb");
    expect(chip.getAttribute("data-label-kind")).toBe("raw");
  });

  it("falls back to the shortened tx hash for a plain transfer with no contract info", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xplain0000000000000000000000000000000000000000000000000000000",
      from: "0xa",
      to: "0xb",
      status: "pending",
    };
    renderCard(
      data({ entity: wallet({ recentTxHashes: [t.hash] }), transactions: [t] }),
    );
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.textContent).toBe("0xplai…000");
    expect(chip.getAttribute("data-label-kind")).toBe("hash");
  });
});
