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
  onSelectTx?: (walletCardId: string) => void;
  onSelectNode?: (nodeId: string) => void;
  lang?: "ja" | "en";
}) {
  const {
    txEntries,
    overflowCount = 0,
    totalPendingCount = txEntries.length,
    nodeEntries = [],
    onSelectTx = () => {},
    onSelectNode = () => {},
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
          onSelectNode={onSelectNode}
        />
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

function txEntry(overrides: Partial<MempoolTxEntry> = {}): MempoolTxEntry {
  const from = overrides.from ?? `0x${"b".repeat(40)}`;
  return {
    hash: `0x${"a".repeat(64)}`,
    from,
    to: `0x${"c".repeat(40)}`,
    // 既定ではクリック可能（walletCardId = from とみなす）にしておき、
    // 個々のテストで undefined を渡してクリック不可のケースを検証する。
    walletCardId: from,
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

  it("calls onSelectTx with walletCardId (not from) when a clickable row is clicked", () => {
    // walletCardId is the resolved wallet card id, which may use different
    // casing than tx.from (see mempoolList.ts / addressCasing.ts). The panel
    // must forward walletCardId, not from, so that Canvas.tsx's getNode()
    // resolves the correct React Flow node.
    const onSelectTx = vi.fn();
    const entry = txEntry({ hash: "0x1", from: "0xaaa", walletCardId: "0xAAA" });
    wrap({ txEntries: [entry], onSelectTx });
    fireEvent.click(screen.getByTestId("mempool-tx-row-0x1"));
    expect(onSelectTx).toHaveBeenCalledWith("0xAAA");
  });

  it("renders a non-clickable row (not a button) when from has no wallet card", () => {
    const entry = txEntry({ hash: "0x1", walletCardId: undefined });
    const onSelectTx = vi.fn();
    wrap({ txEntries: [entry], onSelectTx });
    const row = screen.getByTestId("mempool-tx-row-0x1");
    expect(row.tagName).not.toBe("BUTTON");
    fireEvent.click(row);
    expect(onSelectTx).not.toHaveBeenCalled();
  });

  it("renders a static row (no crash) when a non-wallet entry has an empty from", () => {
    const entry = txEntry({ hash: "0x1", from: "", walletCardId: undefined });
    const onSelectTx = vi.fn();
    wrap({ txEntries: [entry], onSelectTx });
    const row = screen.getByTestId("mempool-tx-row-0x1");
    expect(row.tagName).not.toBe("BUTTON");
    fireEvent.click(row);
    expect(onSelectTx).not.toHaveBeenCalled();
  });

  it("renders multiple rows in the given order", () => {
    wrap({
      txEntries: [
        txEntry({ hash: "0x1" }),
        txEntry({ hash: "0x2" }),
        txEntry({ hash: "0x3" }),
      ],
    });
    const rows = screen.getAllByTestId(/^mempool-tx-row-/);
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "mempool-tx-row-0x1",
      "mempool-tx-row-0x2",
      "mempool-tx-row-0x3",
    ]);
  });

  it("shows the overflow hint with the count when overflowCount > 0", () => {
    wrap({ txEntries: [txEntry({ hash: "0x1" })], overflowCount: 5 });
    expect(screen.getByTestId("mempool-overflow").textContent).toContain("5");
  });

  it("does not show the overflow hint when overflowCount is 0", () => {
    wrap({ txEntries: [txEntry({ hash: "0x1" })], overflowCount: 0 });
    expect(screen.queryByTestId("mempool-overflow")).toBeNull();
  });

  it("does not show the overflow hint in the empty state even if overflowCount > 0", () => {
    // The overflow hint lives inside the non-empty branch, so an empty tx list
    // must never surface it regardless of the passed overflowCount.
    wrap({ txEntries: [], overflowCount: 3 });
    expect(screen.queryByTestId("mempool-overflow")).toBeNull();
    expect(screen.getByTestId("mempool-panel").textContent).toContain(
      "保留中の tx はありません",
    );
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

  it("still renders node rows while the tx list is empty (empty message and node section coexist)", () => {
    wrap({
      txEntries: [],
      nodeEntries: [{ nodeId: "n1", label: "reth-1", pending: 7, queued: 2 }],
    });
    expect(screen.getByTestId("mempool-panel").textContent).toContain(
      "保留中の tx はありません",
    );
    const row = screen.getByTestId("mempool-node-row-n1");
    expect(row.textContent).toContain("reth-1");
    expect(row.textContent).toContain("7");
    expect(row.textContent).toContain("2");
  });

  it("renders distinct rows for nodes that report identical counts", () => {
    wrap({
      txEntries: [],
      nodeEntries: [
        { nodeId: "n1", label: "reth-1", pending: 4, queued: 1 },
        { nodeId: "n2", label: "reth-2", pending: 4, queued: 1 },
      ],
    });
    expect(screen.getByTestId("mempool-node-row-n1").textContent).toContain("reth-1");
    expect(screen.getByTestId("mempool-node-row-n2").textContent).toContain("reth-2");
  });

  it("localizes to English", () => {
    wrap({ txEntries: [], lang: "en" });
    expect(screen.getByTestId("mempool-panel").textContent).toContain(
      "No pending transactions",
    );
  });
});

// Issue #408: ノード別 txpool 行のクリック導線（対応するノードカードへの
// パン）。既存の tx 行（クリック可能な行は button 化される）と同じ流儀を
// ノード別行にも適用したことを確認する。
describe("MempoolPanel node row click (Issue #408)", () => {
  it("renders each node row as a clickable button", () => {
    wrap({
      txEntries: [],
      nodeEntries: [{ nodeId: "n1", label: "reth-1", pending: 3, queued: 1 }],
    });
    expect(screen.getByTestId("mempool-node-row-n1").tagName).toBe("BUTTON");
  });

  it("calls onSelectNode with the entry's nodeId when a node row is clicked", () => {
    const onSelectNode = vi.fn();
    wrap({
      txEntries: [],
      nodeEntries: [{ nodeId: "n1", label: "reth-1", pending: 3, queued: 1 }],
      onSelectNode,
    });
    fireEvent.click(screen.getByTestId("mempool-node-row-n1"));
    expect(onSelectNode).toHaveBeenCalledWith("n1");
  });

  it("calls onSelectNode independently per row when multiple node entries exist", () => {
    const onSelectNode = vi.fn();
    wrap({
      txEntries: [],
      nodeEntries: [
        { nodeId: "n1", label: "reth-1", pending: 3, queued: 1 },
        { nodeId: "n2", label: "reth-2", pending: 0, queued: 0 },
      ],
      onSelectNode,
    });
    fireEvent.click(screen.getByTestId("mempool-node-row-n2"));
    expect(onSelectNode).toHaveBeenCalledTimes(1);
    expect(onSelectNode).toHaveBeenCalledWith("n2");
  });

  it("does not call onSelectTx when a node row is clicked (independent callbacks)", () => {
    const onSelectTx = vi.fn();
    const onSelectNode = vi.fn();
    wrap({
      txEntries: [],
      nodeEntries: [{ nodeId: "n1", label: "reth-1", pending: 3, queued: 1 }],
      onSelectTx,
      onSelectNode,
    });
    fireEvent.click(screen.getByTestId("mempool-node-row-n1"));
    expect(onSelectTx).not.toHaveBeenCalled();
    expect(onSelectNode).toHaveBeenCalledTimes(1);
  });

  it("does not call onSelectNode when a tx row is clicked (reverse independence)", () => {
    const onSelectTx = vi.fn();
    const onSelectNode = vi.fn();
    wrap({
      txEntries: [txEntry({ hash: "0x1", walletCardId: "0xAAA" })],
      nodeEntries: [{ nodeId: "n1", label: "reth-1", pending: 3, queued: 1 }],
      onSelectTx,
      onSelectNode,
    });
    fireEvent.click(screen.getByTestId("mempool-tx-row-0x1"));
    expect(onSelectNode).not.toHaveBeenCalled();
    expect(onSelectTx).toHaveBeenCalledTimes(1);
  });

  it("fires onSelectNode once per click with no built-in double-submit guard", () => {
    // tx 行・削除ボタンと同じく、連打の抑止は UI 側では行わない
    // （各クリックが独立に1発行。パン先の解決・防御は Canvas.tsx 側の責務）。
    const onSelectNode = vi.fn();
    wrap({
      txEntries: [],
      nodeEntries: [{ nodeId: "n1", label: "reth-1", pending: 3, queued: 1 }],
      onSelectNode,
    });
    const row = screen.getByTestId("mempool-node-row-n1");
    fireEvent.click(row);
    fireEvent.click(row);
    expect(onSelectNode).toHaveBeenCalledTimes(2);
    expect(onSelectNode).toHaveBeenNthCalledWith(1, "n1");
    expect(onSelectNode).toHaveBeenNthCalledWith(2, "n1");
  });

  it("passes the correct nodeId when clicking rows in an arbitrary order across many nodes", () => {
    // 複数ノードの行を連続でクリックしても、常にクリックした行自身の
    // nodeId が渡る（隣接行のインデックスずれ・取り違えが無いこと）。
    const onSelectNode = vi.fn();
    wrap({
      txEntries: [],
      nodeEntries: [
        { nodeId: "n1", label: "reth-1", pending: 1, queued: 0 },
        { nodeId: "n2", label: "reth-2", pending: 2, queued: 0 },
        { nodeId: "n3", label: "reth-3", pending: 3, queued: 0 },
      ],
      onSelectNode,
    });
    fireEvent.click(screen.getByTestId("mempool-node-row-n3"));
    fireEvent.click(screen.getByTestId("mempool-node-row-n1"));
    fireEvent.click(screen.getByTestId("mempool-node-row-n2"));
    expect(onSelectNode.mock.calls.map((c) => c[0])).toEqual(["n3", "n1", "n2"]);
  });

  it("renders a clickable node row even when the label is an empty string (defensive)", () => {
    // containerName が空文字でも行（ボタン）自体は描画し、クリックで
    // nodeId を渡す（空ラベルでパン導線を落とさない安全側）。
    const onSelectNode = vi.fn();
    wrap({
      txEntries: [],
      nodeEntries: [{ nodeId: "n1", label: "", pending: 0, queued: 0 }],
      onSelectNode,
    });
    const row = screen.getByTestId("mempool-node-row-n1");
    expect(row.tagName).toBe("BUTTON");
    fireEvent.click(row);
    expect(onSelectNode).toHaveBeenCalledWith("n1");
  });

  it("renders large pending/queued counts in a node row without truncation", () => {
    wrap({
      txEntries: [],
      nodeEntries: [{ nodeId: "n1", label: "reth-1", pending: 123456, queued: 98765 }],
    });
    expect(screen.getByTestId("mempool-node-row-n1").textContent).toContain(
      "pending 123456 · queued 98765",
    );
  });

  it("exposes the jump hint as the node row's title attribute", () => {
    wrap({
      txEntries: [],
      nodeEntries: [{ nodeId: "n1", label: "reth-1", pending: 3, queued: 1 }],
    });
    expect(screen.getByTestId("mempool-node-row-n1").getAttribute("title")).toBe(
      "クリックでキャンバス上のノードカードへ移動",
    );
  });
});
