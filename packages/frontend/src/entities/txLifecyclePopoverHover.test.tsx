import type { TransactionEntity, WalletEntity } from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { HOVER_POPOVER_CLOSE_DELAY_MS } from "../interaction/useHoverPopover.js";
import { RibbonHoverProvider } from "./RibbonHoverContext.js";
import { DEFAULT_RECENT_TX_LIMIT } from "./transaction.js";
import { WalletCard } from "./WalletCard.js";
import { WalletPopover } from "./WalletPopover.js";
import type { WalletFlowNode } from "./walletNode.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** mouseleave 後の遅延クローズ（Issue #221）を経過させるヘルパー。 */
function advancePastCloseDelay(): void {
  act(() => {
    vi.advanceTimersByTime(HOVER_POPOVER_CLOSE_DELAY_MS);
  });
}

/**
 * TxChip(WalletCard) / WalletPopoverTxItem(WalletPopover) の hover ポップオーバー
 * 開閉の独立性を検証する(Issue #212 単位D)。1件のホバー状態が別の tx チップ/
 * 行へ漏れないこと、DEFAULT_RECENT_TX_LIMIT 件を同時に並べても各 tx ごとに
 * 独立して開閉することを確認する。
 */

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

function tx(hash: string, status: TransactionEntity["status"] = "pending"): TransactionEntity {
  return { kind: "transaction", hash, from: "0xa", to: "0xb", status };
}

function makeTxs(count: number): TransactionEntity[] {
  return Array.from({ length: count }, (_, i) =>
    tx(`0x${i.toString().padStart(16, "0")}`),
  );
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

function cardData(txs: TransactionEntity[]): WalletFlowNode["data"] {
  return {
    entity: wallet({ recentTxHashes: txs.map((t) => t.hash) }),
    transactions: txs,
    popoverTransactions: txs,
    settlingHashes: [],
    ownerPresent: true,
    contractsByAddress: new Map(),
  };
}

function popover(hash: string) {
  return screen.queryByTestId(`tx-lifecycle-popover-${hash}`);
}

describe("WalletCard TxChip lifecycle popover open/close (Issue #212 単位D)", () => {
  it("renders no lifecycle popover until a chip is hovered", () => {
    const t = tx("0xdeadbeef00000000");
    renderCard(cardData([t]));
    expect(popover(t.hash)).toBeNull();
  });

  it(
    "opens only the hovered chip's popover, then closes it on mouse leave " +
      "after the close delay (Issue #221)",
    () => {
      const t = tx("0xdeadbeef00000000");
      renderCard(cardData([t]));
      const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);

      fireEvent.mouseEnter(chip);
      expect(popover(t.hash)).toBeTruthy();

      fireEvent.mouseLeave(chip);
      // 即座には消えない（隙間通過中の可能性があるため）。
      expect(popover(t.hash)).toBeTruthy();
      advancePastCloseDelay();
      expect(popover(t.hash)).toBeNull();
    },
  );

  it("opens/closes on keyboard focus and blur too", () => {
    const t = tx("0xdeadbeef00000000");
    renderCard(cardData([t]));
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);

    fireEvent.focus(chip);
    expect(popover(t.hash)).toBeTruthy();

    fireEvent.blur(chip);
    expect(popover(t.hash)).toBeNull();
  });

  it("keeps each chip's popover independent — hovering one does not open another", () => {
    const [a, b, c] = makeTxs(3);
    renderCard(cardData([a, b, c]));

    fireEvent.mouseEnter(screen.getByTestId(`wallet-tx-chip-${a.hash}`));
    expect(popover(a.hash)).toBeTruthy();
    expect(popover(b.hash)).toBeNull();
    expect(popover(c.hash)).toBeNull();

    // 別チップに移ると前のは閉じ、新しいのだけ開く（前のクローズは遅延して
    // 効くため、閉じたと判定するには猶予時間を経過させる。Issue #221）。
    fireEvent.mouseLeave(screen.getByTestId(`wallet-tx-chip-${a.hash}`));
    fireEvent.mouseEnter(screen.getByTestId(`wallet-tx-chip-${b.hash}`));
    advancePastCloseDelay();
    expect(popover(a.hash)).toBeNull();
    expect(popover(b.hash)).toBeTruthy();
    expect(popover(c.hash)).toBeNull();
  });

  it("handles the full DEFAULT_RECENT_TX_LIMIT set of chips with independent popovers", () => {
    const txs = makeTxs(DEFAULT_RECENT_TX_LIMIT);
    renderCard(cardData(txs));
    // 全チップが描画されている。
    for (const t of txs) {
      expect(screen.getByTestId(`wallet-tx-chip-${t.hash}`)).toBeTruthy();
      expect(popover(t.hash)).toBeNull();
    }
    // 最後の1件だけ開き、他は閉じたまま。
    const last = txs[txs.length - 1];
    fireEvent.mouseEnter(screen.getByTestId(`wallet-tx-chip-${last.hash}`));
    for (const t of txs) {
      if (t.hash === last.hash) expect(popover(t.hash)).toBeTruthy();
      else expect(popover(t.hash)).toBeNull();
    }
  });
});

describe("WalletPopover tx item lifecycle popover open/close (Issue #212 単位D)", () => {
  function renderPopover(txs: TransactionEntity[]) {
    // PopoverPortal(Issue #245)の必須 prop anchorRef 用の detached 要素。
    const anchorRef = { current: document.createElement("div") };
    render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <WalletPopover anchorRef={anchorRef} entity={wallet()} transactions={txs} />
        </GlossaryProvider>
      </LanguageProvider>,
    );
  }

  it("shows no nested lifecycle popover until a tx row is hovered", () => {
    const t = tx("0xdeadbeef00000000");
    renderPopover([t]);
    expect(popover(t.hash)).toBeNull();
  });

  it(
    "opens the lifecycle popover for the hovered row only, and closes on leave " +
      "after the close delay (Issue #221)",
    () => {
      const [a, b] = makeTxs(2);
      renderPopover([a, b]);
      const rowA = screen.getByText("0x000000…0000").closest("li");
      expect(rowA).not.toBeNull();

      fireEvent.mouseEnter(rowA as HTMLElement);
      expect(popover(a.hash)).toBeTruthy();
      expect(popover(b.hash)).toBeNull();

      fireEvent.mouseLeave(rowA as HTMLElement);
      // 即座には消えない。
      expect(popover(a.hash)).toBeTruthy();
      advancePastCloseDelay();
      expect(popover(a.hash)).toBeNull();
    },
  );
});
