import type { ContractEntity, TransactionEntity, WalletEntity } from "@chainviz/shared";
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

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: `0x${"c".repeat(40)}`,
    chainType: "ethereum",
    ...overrides,
  };
}

function wrap(
  transactions: TransactionEntity[],
  contractsByAddress?: ReadonlyMap<string, ContractEntity>,
) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <WalletPopover
          entity={wallet()}
          transactions={transactions}
          contractsByAddress={contractsByAddress}
        />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("WalletPopover call preview (ARCHITECTURE.md §6.6)", () => {
  it("shows nothing extra for a plain transfer without contract info", () => {
    const tx: TransactionEntity = {
      kind: "transaction",
      hash: "0x1",
      from: "0xa",
      to: "0xb",
      status: "included",
    };
    wrap([tx]);
    expect(screen.queryByTestId(`wallet-tx-call-${tx.hash}`)).toBeNull();
  });

  it("shows the function name, an args preview, and the resolved contract name", () => {
    const contractAddress = `0x${"c".repeat(40)}`;
    const tx: TransactionEntity = {
      kind: "transaction",
      hash: "0x1",
      from: "0xa",
      to: contractAddress,
      status: "included",
      contractCall: {
        contractAddress,
        functionName: "transfer",
        args: [
          { name: "to", value: `0x${"b".repeat(40)}` },
          { name: "amount", value: "1000000000000000000" },
        ],
      },
    };
    const byAddress = new Map([
      [contractAddress, contract({ address: contractAddress, name: "ChainvizToken" })],
    ]);
    wrap([tx], byAddress);
    const line = screen.getByTestId(`wallet-tx-call-${tx.hash}`);
    expect(line.textContent).toBe(
      "transfer(to: 0xbbbbbb…bbbb, amount: 1000000000000000000) → ChainvizToken",
    );
  });

  it("falls back to the shortened address when the destination contract is unknown", () => {
    const contractAddress = `0x${"d".repeat(40)}`;
    const tx: TransactionEntity = {
      kind: "transaction",
      hash: "0x1",
      from: "0xa",
      to: contractAddress,
      status: "included",
      contractCall: { contractAddress, rawFunctionId: "0xa9059cbb" },
    };
    wrap([tx]);
    const line = screen.getByTestId(`wallet-tx-call-${tx.hash}`);
    expect(line.textContent).toBe("0xa9059cbb() → 0xdddddd…dddd");
  });

  it("caps the args preview at 2 entries even when more are decoded", () => {
    const contractAddress = `0x${"c".repeat(40)}`;
    const tx: TransactionEntity = {
      kind: "transaction",
      hash: "0x1",
      from: "0xa",
      to: contractAddress,
      status: "included",
      contractCall: {
        contractAddress,
        functionName: "swap",
        args: [
          { name: "a", value: "1" },
          { name: "b", value: "2" },
          { name: "c", value: "3" },
        ],
      },
    };
    wrap([tx]);
    const line = screen.getByTestId(`wallet-tx-call-${tx.hash}`);
    expect(line.textContent).toBe("swap(a: 1, b: 2) → 0xcccccc…cccc");
  });

  it("shows the deploy label for a deploy tx and resolves the created contract's name", () => {
    const createdAddress = `0x${"e".repeat(40)}`;
    const tx: TransactionEntity = {
      kind: "transaction",
      hash: "0x1",
      from: "0xa",
      to: null,
      status: "included",
      createdContractAddress: createdAddress,
    };
    const byAddress = new Map([
      [createdAddress, contract({ address: createdAddress, name: "Counter" })],
    ]);
    wrap([tx], byAddress);
    const line = screen.getByTestId(`wallet-tx-call-${tx.hash}`);
    expect(line.textContent).toBe("デプロイ → Counter");
  });

  it("shows the deploy label with a shortened address when the deployed contract is not yet observed", () => {
    const createdAddress = `0x${"f".repeat(40)}`;
    const tx: TransactionEntity = {
      kind: "transaction",
      hash: "0x1",
      from: "0xa",
      to: null,
      status: "included",
      createdContractAddress: createdAddress,
    };
    wrap([tx]);
    const line = screen.getByTestId(`wallet-tx-call-${tx.hash}`);
    expect(line.textContent).toBe("デプロイ → 0xffffff…ffff");
  });
});
