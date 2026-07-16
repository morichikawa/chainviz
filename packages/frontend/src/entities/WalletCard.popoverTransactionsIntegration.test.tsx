import type { TransactionEntity, WalletEntity } from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { RibbonHoverProvider } from "./RibbonHoverContext.js";
import { DEFAULT_RECENT_TX_LIMIT } from "./transaction.js";
import { WalletCard } from "./WalletCard.js";
import type { WalletFlowNode } from "./walletNode.js";

/**
 * Issue #320 の配線を固定する回帰テスト。`WalletCard` はカード面の tx チップに
 * `data.transactions`（`DEFAULT_RECENT_TX_LIMIT` 件まで）を使う一方、
 * ホバーで開く `WalletPopover` へは `data.popoverTransactions`（全件）を渡す
 * 必要がある。ここを取り違えて `data.transactions` を渡し戻すと、
 * ポップオーバーがスクロール対応してもカードと同じ6件しか表示されない
 * （Issue #320 の再発）ため、実際にカードをホバーして確認する。
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

function tx(hash: string): TransactionEntity {
  return { kind: "transaction", hash, from: "0xa", to: "0xb", status: "included" };
}

function renderCard(data: WalletFlowNode["data"]) {
  const props = { data } as unknown as Parameters<typeof WalletCard>[0];
  return render(
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

describe("WalletCard -> WalletPopover popoverTransactions wiring (Issue #320)", () => {
  it("shows more tx entries in the popover than are shown as chips on the card", () => {
    const cardCount = DEFAULT_RECENT_TX_LIMIT;
    const popoverCount = DEFAULT_RECENT_TX_LIMIT + 4;
    const cardTxs = Array.from({ length: cardCount }, (_, i) => tx(`0xcard${i}`));
    const popoverTxs = Array.from({ length: popoverCount }, (_, i) => tx(`0xall${i}`));

    const wb = wallet();
    const { container } = renderCard({
      entity: wb,
      transactions: cardTxs,
      popoverTransactions: popoverTxs,
      settlingHashes: [],
      ownerPresent: true,
      contractsByAddress: new Map(),
    });

    // カード面のチップは cardCount 件。
    expect(
      container.querySelectorAll(".wallet-card__tx-chips .wallet-tx-chip"),
    ).toHaveLength(cardCount);

    fireEvent.mouseEnter(screen.getByTestId(`wallet-card-${wb.address}`));

    // ポップオーバーの一覧は popoverCount 件（カードより多い = data.transactions
    // ではなく data.popoverTransactions が使われている証拠）。
    const list = document.querySelector(".wallet-popover__tx-list");
    expect(list?.children).toHaveLength(popoverCount);
  });
});
