import type { TransactionEntity, WalletEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { WalletPopover } from "./WalletPopover.js";

afterEach(cleanup);

const WALLET_ADDRESS = `0x${"a".repeat(40)}`;
const OTHER_ADDRESS = `0x${"b".repeat(40)}`;

function wallet(overrides: Partial<WalletEntity> = {}): WalletEntity {
  return {
    kind: "wallet",
    address: WALLET_ADDRESS,
    chainType: "ethereum",
    balance: (3n * 10n ** 18n).toString(),
    nonce: 5,
    isSmartAccount: false,
    ownerWorkbenchId: "workbench-alice",
    recentTxHashes: [],
    ...overrides,
  };
}

function tx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    kind: "transaction",
    hash: "0x1",
    from: WALLET_ADDRESS,
    to: OTHER_ADDRESS,
    status: "included",
    ...overrides,
  };
}

function wrap(transactions: TransactionEntity[]) {
  // PopoverPortal(Issue #245)の必須 prop anchorRef 用の detached 要素。
  const anchorRef = { current: document.createElement("div") };
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <WalletPopover anchorRef={anchorRef} entity={wallet()} transactions={transactions} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

// Issue #319: 各tx項目に、そのtxが消費したnonce値を表示する。ただし
// 「送信tx（tx.from がこのウォレット自身）」限定で、受信txやnonce未観測の
// txでは表示しない（受信txのnonceは送信元ウォレットのものであり、この
// ウォレットの送信順序と混同させないため）。
describe("WalletPopoverTxItem nonce display (Issue #319)", () => {
  it("shows the nonce for a tx sent by this wallet", () => {
    wrap([tx({ hash: "0xsent", from: WALLET_ADDRESS, nonce: 3 })]);
    const nonceEl = screen.getByTestId("wallet-tx-nonce-0xsent");
    expect(nonceEl.textContent).toBe("nonce 3");
  });

  it("does not show a nonce for a tx received from another wallet", () => {
    wrap([tx({ hash: "0xreceived", from: OTHER_ADDRESS, to: WALLET_ADDRESS, nonce: 7 })]);
    expect(screen.queryByTestId("wallet-tx-nonce-0xreceived")).toBeNull();
  });

  it("does not show a nonce when the tx has no observed nonce", () => {
    wrap([tx({ hash: "0xunknown", from: WALLET_ADDRESS, nonce: undefined })]);
    expect(screen.queryByTestId("wallet-tx-nonce-0xunknown")).toBeNull();
  });

  it("shows the nonce 0 (falsy but meaningful) for the first sent tx", () => {
    wrap([tx({ hash: "0xfirst", from: WALLET_ADDRESS, nonce: 0 })]);
    const nonceEl = screen.getByTestId("wallet-tx-nonce-0xfirst");
    expect(nonceEl.textContent).toBe("nonce 0");
  });

  it("matches the wallet address case-insensitively", () => {
    wrap([tx({ hash: "0xmixedcase", from: WALLET_ADDRESS.toUpperCase(), nonce: 2 })]);
    expect(screen.getByTestId("wallet-tx-nonce-0xmixedcase")).toBeTruthy();
  });
});
