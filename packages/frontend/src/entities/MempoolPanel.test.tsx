import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { MempoolNodeEntry, MempoolTxEntry } from "./mempoolList.js";
import { MempoolPanel } from "./MempoolPanel.js";

afterEach(cleanup);

const glossary: Glossary = {
  mempool: {
    key: "mempool",
    name: { ja: "mempool", en: "Mempool" },
    definition: { ja: "定義", en: "definition" },
    layer: "c-transaction",
    relatedTerms: [],
  },
  txpool: {
    key: "txpool",
    name: { ja: "txpool", en: "Txpool" },
    definition: { ja: "定義", en: "definition" },
    layer: "d-internal",
    relatedTerms: [],
  },
};

function wrap(props: {
  txEntries: MempoolTxEntry[];
  overflowCount?: number;
  totalPendingCount?: number;
  nodeEntries?: MempoolNodeEntry[];
  onSelectTx?: (from: string) => void;
  lang?: "ja" | "en";
}) {
  const {
    txEntries,
    overflowCount = 0,
    totalPendingCount = txEntries.length,
    nodeEntries = [],
    onSelectTx = () => {},
    lang = "ja",
  } = props;
  return render(
    <LanguageProvider initialLanguage={lang}>
      <GlossaryProvider glossary={glossary}>
        <MempoolPanel
          txEntries={txEntries}
          overflowCount={overflowCount}
          totalPendingCount={totalPendingCount}
          nodeEntries={nodeEntries}
          onSelectTx={onSelectTx}
        />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

function txEntry(overrides: Partial<MempoolTxEntry> = {}): MempoolTxEntry {
  return {
    hash: `0x${"a".repeat(64)}`,
    from: `0x${"b".repeat(40)}`,
    to: `0x${"c".repeat(40)}`,
    fromIsWallet: true,
    ...overrides,
  };
}

describe("MempoolPanel", () => {
  it("renders even when there are zero pending entries (always-on panel)", () => {
    wrap({ txEntries: [] });
    expect(screen.getByTestId("mempool-panel")).toBeTruthy();
  });

  it("shows the empty-state message when there are zero pending entries", () => {
    wrap({ txEntries: [] });
    const panel = screen.getByTestId("mempool-panel");
    expect(panel.textContent).toContain("保留中の tx はありません");
  });

  it("shows the header count as the total pending count, not just visible rows", () => {
    wrap({ txEntries: [txEntry({ hash: "0x1" })], totalPendingCount: 42 });
    expect(screen.getByTestId("mempool-panel").textContent).toContain("42");
  });

  it("renders a row per tx entry with hash, from, and to", () => {
    const entry = txEntry({
      hash: `0x${"1".repeat(64)}`,
      from: `0x${"a".repeat(40)}`,
      to: `0x${"d".repeat(40)}`,
    });
    wrap({ txEntries: [entry] });
    const row = screen.getByTestId(`mempool-tx-row-${entry.hash}`);
    expect(row.textContent).toContain("0xaaaaaa…aaaa");
    expect(row.textContent).toContain("0xdddddd…dddd");
  });

  it("shows the function name when present", () => {
    const entry = txEntry({ hash: "0x1", functionName: "transfer" });
    wrap({ txEntries: [entry] });
    expect(screen.getByTestId("mempool-tx-row-0x1").textContent).toContain("transfer");
  });

  it("shows a deploy placeholder instead of a 'to' address when to is null", () => {
    const entry = txEntry({ hash: "0x1", to: null });
    wrap({ txEntries: [entry] });
    expect(screen.getByTestId("mempool-tx-row-0x1").textContent).toContain("デプロイ");
  });

  it("calls onSelectTx with the from address when a clickable row is clicked", () => {
    const onSelectTx = vi.fn();
    const entry = txEntry({ hash: "0x1", from: "0xaaa", fromIsWallet: true });
    wrap({ txEntries: [entry], onSelectTx });
    fireEvent.click(screen.getByTestId("mempool-tx-row-0x1"));
    expect(onSelectTx).toHaveBeenCalledWith("0xaaa");
  });

  it("renders a non-clickable row (not a button) when from has no wallet card", () => {
    const entry = txEntry({ hash: "0x1", fromIsWallet: false });
    const onSelectTx = vi.fn();
    wrap({ txEntries: [entry], onSelectTx });
    const row = screen.getByTestId("mempool-tx-row-0x1");
    expect(row.tagName).not.toBe("BUTTON");
    fireEvent.click(row);
    expect(onSelectTx).not.toHaveBeenCalled();
  });

  it("shows the overflow hint with the count when overflowCount > 0", () => {
    wrap({ txEntries: [txEntry({ hash: "0x1" })], overflowCount: 5 });
    expect(screen.getByTestId("mempool-overflow").textContent).toContain("5");
  });

  it("does not show the overflow hint when overflowCount is 0", () => {
    wrap({ txEntries: [txEntry({ hash: "0x1" })], overflowCount: 0 });
    expect(screen.queryByTestId("mempool-overflow")).toBeNull();
  });

  it("renders a node-count row per node entry", () => {
    wrap({
      txEntries: [],
      nodeEntries: [
        { nodeId: "n1", label: "reth-1", pending: 3, queued: 1 },
        { nodeId: "n2", label: "reth-2", pending: 0, queued: 0 },
      ],
    });
    const row1 = screen.getByTestId("mempool-node-row-n1");
    expect(row1.textContent).toContain("reth-1");
    expect(row1.textContent).toContain("3");
    expect(row1.textContent).toContain("1");
    const row2 = screen.getByTestId("mempool-node-row-n2");
    expect(row2.textContent).toContain("reth-2");
  });

  it("omits the node section entirely when there are no node entries", () => {
    wrap({ txEntries: [], nodeEntries: [] });
    expect(screen.queryByTestId(/^mempool-node-row-/)).toBeNull();
  });

  it("localizes to English", () => {
    wrap({ txEntries: [], lang: "en" });
    expect(screen.getByTestId("mempool-panel").textContent).toContain(
      "No pending transactions",
    );
  });
});
