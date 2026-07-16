import type { TransactionEntity, WalletEntity } from "@chainviz/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { Language } from "../i18n/i18n.js";
import { DEFAULT_RECENT_TX_LIMIT } from "./transaction.js";
import { WalletPopover } from "./WalletPopover.js";

/**
 * Issue #320: WalletPopover の tx 一覧が全件描画されること、スクロール用の
 * コンテナクラス（`.wallet-popover` / `.wallet-popover__tx-list`。実際の
 * `overflow-y: auto` 等の CSS 適用自体は `walletPopoverStyles.test.ts` で
 * styles.css の内容を検証する）、見出しの件数表示を確認する。
 */

afterEach(cleanup);

function wallet(overrides: Partial<WalletEntity> = {}): WalletEntity {
  return {
    kind: "wallet",
    address: `0x${"a".repeat(40)}`,
    chainType: "ethereum",
    balance: "0",
    nonce: 0,
    isSmartAccount: false,
    ownerWorkbenchId: "workbench-alice",
    recentTxHashes: [],
    ...overrides,
  };
}

function txs(count: number): TransactionEntity[] {
  return Array.from({ length: count }, (_, i) => ({
    kind: "transaction",
    hash: `0x${i}`,
    from: "0xa",
    to: "0xb",
    status: "included",
  }));
}

function wrap(transactions: TransactionEntity[], language: Language = "ja") {
  const anchorRef = { current: document.createElement("div") };
  return render(
    <LanguageProvider initialLanguage={language}>
      <GlossaryProvider glossary={{}}>
        <WalletPopover anchorRef={anchorRef} entity={wallet()} transactions={transactions} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("WalletPopover full tx list rendering (Issue #320)", () => {
  it("renders every transaction, not capped at DEFAULT_RECENT_TX_LIMIT", () => {
    const count = DEFAULT_RECENT_TX_LIMIT + 5;
    wrap(txs(count));
    const list = document.querySelector(".wallet-popover__tx-list");
    expect(list?.children).toHaveLength(count);
  });

  it("renders a single transaction without issue (lower boundary)", () => {
    wrap(txs(1));
    const list = document.querySelector(".wallet-popover__tx-list");
    expect(list?.children).toHaveLength(1);
  });

  it("applies the wallet-popover width modifier class alongside infra-popover", () => {
    wrap(txs(1));
    const popover = screen.getByRole("tooltip");
    expect(popover.className).toContain("infra-popover");
    expect(popover.className).toContain("wallet-popover");
  });
});

describe("WalletPopover tx list heading count (Issue #320)", () => {
  it("shows the tx count in Japanese when there is at least one transaction", () => {
    wrap(txs(3), "ja");
    expect(screen.getByText("直近の tx（3件）")).toBeTruthy();
  });

  it("shows the tx count in English when there is at least one transaction", () => {
    wrap(txs(3), "en");
    expect(screen.getByText("Recent tx (3)")).toBeTruthy();
  });

  it("reflects a count larger than DEFAULT_RECENT_TX_LIMIT in the heading", () => {
    const count = DEFAULT_RECENT_TX_LIMIT + 2;
    wrap(txs(count), "ja");
    expect(screen.getByText(`直近の tx（${count}件）`)).toBeTruthy();
  });

  it("falls back to the plain label (no count) when there are no transactions", () => {
    wrap([], "ja");
    expect(screen.getByText("直近の tx")).toBeTruthy();
    expect(screen.queryByText(/直近の tx（/)).toBeNull();
    expect(screen.getByText("トランザクションなし")).toBeTruthy();
  });
});
