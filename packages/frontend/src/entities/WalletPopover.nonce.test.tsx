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

function wrap(
  transactions: TransactionEntity[],
  walletEntity: WalletEntity = wallet(),
) {
  // PopoverPortal(Issue #245)の必須 prop anchorRef 用の detached 要素。
  const anchorRef = { current: document.createElement("div") };
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <WalletPopover anchorRef={anchorRef} entity={walletEntity} transactions={transactions} />
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

  it("matches when the wallet address is uppercase and tx.from is lowercase (reverse direction)", () => {
    // 大文字小文字の比較は双方向に対称であること。前テストは from を大文字化
    // したが、こちらはウォレット側（walletAddress）を大文字化して逆方向を突く。
    const upperWallet = wallet({ address: WALLET_ADDRESS.toUpperCase() });
    wrap([tx({ hash: "0xrev", from: WALLET_ADDRESS, nonce: 8 })], upperWallet);
    expect(screen.getByTestId("wallet-tx-nonce-0xrev")).toBeTruthy();
  });

  it("does not show a nonce (and does not crash) when tx.from is an empty string", () => {
    // tx.from は型上 string だが、想定外に空文字が来ても toLowerCase() は
    // 例外を投げず、ウォレットアドレスと一致しないため nonce を出さない。
    wrap([tx({ hash: "0xempty", from: "", nonce: 1 })]);
    expect(screen.queryByTestId("wallet-tx-nonce-0xempty")).toBeNull();
  });

  it("shows nonce only on sent txs when sent and received txs are mixed", () => {
    // 送信 tx と受信 tx が同一ウォレットの履歴に混在するとき、送信 tx にのみ
    // nonce を出し受信 tx には出さない（行の主語＝このウォレットの送信順序と
    // 受信元の nonce を混同させない）。
    wrap([
      tx({ hash: "0xsent1", from: WALLET_ADDRESS, to: OTHER_ADDRESS, nonce: 10 }),
      tx({ hash: "0xrecv1", from: OTHER_ADDRESS, to: WALLET_ADDRESS, nonce: 11 }),
      tx({ hash: "0xsent2", from: WALLET_ADDRESS, to: OTHER_ADDRESS, nonce: 12 }),
    ]);
    expect(screen.getByTestId("wallet-tx-nonce-0xsent1").textContent).toBe("nonce 10");
    expect(screen.queryByTestId("wallet-tx-nonce-0xrecv1")).toBeNull();
    expect(screen.getByTestId("wallet-tx-nonce-0xsent2").textContent).toBe("nonce 12");
  });

  it("renders a large nonce value verbatim", () => {
    // 極端に大きい nonce（collector 側で精度落ちしても有限値）でも、表示側は
    // 受け取った数値をそのまま連結して出す。
    wrap([tx({ hash: "0xbig", from: WALLET_ADDRESS, nonce: 1234567 })]);
    expect(screen.getByTestId("wallet-tx-nonce-0xbig").textContent).toBe("nonce 1234567");
  });
});
