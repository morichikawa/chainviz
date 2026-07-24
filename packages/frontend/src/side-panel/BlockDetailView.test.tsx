// BlockDetailView（Issue #409。ARCHITECTURE.md §17.4）のテスト。この
// コンポーネントは渡された props をそのまま表示する純粋な表示コンポーネント
// であり、対象ブロックの解決・ダングリングガード・前後ナビゲーションの導出
// (blockDetail.ts) は別ファイルでテストする（CLAUDE.md のテスト分割方針。
// blockDetail.test.ts / SidePanelHost.blockDetail.test.tsx 参照）。
import type { BlockEntity, ContractEntity, TransactionEntity } from "@chainviz/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BlockNavigation } from "../entities/blockDetail.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { BlockDetailView, type BlockDetailViewProps } from "./BlockDetailView.js";

afterEach(cleanup);

function block(overrides: Partial<BlockEntity> & { hash: string }): BlockEntity {
  return {
    kind: "block",
    number: 42,
    parentHash: "0xparent-full-hash",
    timestamp: 1_700_000_000,
    receivedAt: {},
    ...overrides,
  };
}

function navigation(overrides: Partial<BlockNavigation> = {}): BlockNavigation {
  return {
    parent: undefined,
    child: undefined,
    isLatest: false,
    ...overrides,
  };
}

function tx(overrides: Partial<TransactionEntity> & { hash: string }): TransactionEntity {
  return {
    kind: "transaction",
    from: "0xfrom0000000000000000000000000000000001",
    to: "0xto000000000000000000000000000000000002",
    status: "included",
    ...overrides,
  };
}

// jest-dom の toBeDisabled() は導入していないため、既存の他テスト
// （CanvasToolbar.test.tsx 等）と同じ「HTMLButtonElement へキャストして
// .disabled を直接見る」流儀に揃える。
function isDisabled(testId: string): boolean {
  return (screen.getByTestId(testId) as HTMLButtonElement).disabled;
}

function renderView(overrides: Partial<BlockDetailViewProps> = {}) {
  const target = block({ hash: "0xtargetblockhash" });
  const props: BlockDetailViewProps = {
    block: target,
    navigation: navigation(),
    receivedOrder: [],
    visibleTransactions: [],
    totalTxCount: 0,
    overflowCount: 0,
    contractsByAddress: new Map<string, ContractEntity>(),
    onNavigate: vi.fn(),
    ...overrides,
  };
  render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <BlockDetailView {...props} />
      </GlossaryProvider>
    </LanguageProvider>,
  );
  return props;
}

describe("BlockDetailView: header and fields", () => {
  it("shows the block number, a shortened hash in the header, the full hash/parent hash in the fields, and the timestamp", () => {
    // ヘッダーは shortHex で短縮表示、フィールド欄は全文表示（Issue #409。
    // ARCHITECTURE.md §17.4「フル hash」）という違いを実際に区別できるよう、
    // shortHex が短縮を発生させる長さのハッシュを使う。
    const fullHash = `0x${"a".repeat(64)}`;
    const fullParentHash = `0x${"b".repeat(64)}`;
    renderView({
      block: block({
        hash: fullHash,
        number: 7,
        timestamp: 1_700_000_000,
        parentHash: fullParentHash,
      }),
    });
    expect(screen.getByText("#7")).toBeTruthy();
    expect(screen.getByText(`0xaaaaaa…${"a".repeat(4)}`)).toBeTruthy(); // ヘッダー: shortHex
    expect(screen.getByText(fullHash)).toBeTruthy(); // フィールド: 全文
    expect(screen.getByText(fullParentHash)).toBeTruthy(); // フィールド: 全文
    expect(screen.getByText("2023-11-14 22:13:20 UTC")).toBeTruthy();
  });

  it("shows an empty-received message when receivedOrder is empty", () => {
    renderView({ receivedOrder: [] });
    expect(screen.getByText("受信時刻をまだ観測していません")).toBeTruthy();
  });

  it("lists all received-order entries without truncation", () => {
    renderView({
      receivedOrder: [
        { nodeId: "n1", label: "reth1", offsetMs: 0 },
        { nodeId: "n2", label: "reth2", offsetMs: 120 },
        { nodeId: "n3", label: "reth3", offsetMs: 340 },
      ],
    });
    expect(screen.getByText("reth1")).toBeTruthy();
    expect(screen.getByText("reth2")).toBeTruthy();
    expect(screen.getByText("reth3")).toBeTruthy();
    expect(screen.getByText("+340ms")).toBeTruthy();
  });
});

describe("BlockDetailView: parent hash navigation", () => {
  it("renders the parent hash as a clickable link that navigates when a parent exists", () => {
    const target = block({ hash: "0xtarget", parentHash: "0xparent" });
    const onNavigate = vi.fn();
    renderView({
      block: target,
      navigation: navigation({ parent: block({ hash: "0xparent", number: 41 }) }),
      onNavigate,
    });
    fireEvent.click(screen.getByTestId("block-detail-parent-link-0xtarget"));
    expect(onNavigate).toHaveBeenCalledWith("0xparent");
  });

  it("renders the parent hash as plain (non-interactive) text when there is no parent", () => {
    const target = block({ hash: "0xtarget", parentHash: "0xoutside" });
    renderView({ block: target, navigation: navigation({ parent: undefined }) });
    expect(screen.queryByTestId("block-detail-parent-link-0xtarget")).toBeNull();
    expect(screen.getByText("0xoutside")).toBeTruthy();
  });
});

describe("BlockDetailView: prev/next navigation buttons", () => {
  it("enables 'previous block' and navigates to the parent's hash when clicked", () => {
    const target = block({ hash: "0xtarget" });
    const onNavigate = vi.fn();
    renderView({
      block: target,
      navigation: navigation({ parent: block({ hash: "0xparent" }) }),
      onNavigate,
    });
    const prevButton = screen.getByTestId("block-detail-prev-0xtarget");
    expect(isDisabled("block-detail-prev-0xtarget")).toBe(false);
    fireEvent.click(prevButton);
    expect(onNavigate).toHaveBeenCalledWith("0xparent");
    expect(screen.queryByTestId("block-detail-prev-reason")).toBeNull();
  });

  it("disables 'previous block' and shows the retention-window reason when there is no parent", () => {
    const target = block({ hash: "0xtarget" });
    renderView({ block: target, navigation: navigation({ parent: undefined }) });
    expect(isDisabled("block-detail-prev-0xtarget")).toBe(true);
    expect(screen.getByTestId("block-detail-prev-reason").textContent).toBe(
      "これより前は保持期間外のため表示できません",
    );
  });

  it("enables 'next block' and navigates to the child's hash when clicked", () => {
    const target = block({ hash: "0xtarget" });
    const onNavigate = vi.fn();
    renderView({
      block: target,
      navigation: navigation({ child: block({ hash: "0xchild" }) }),
      onNavigate,
    });
    const nextButton = screen.getByTestId("block-detail-next-0xtarget");
    expect(isDisabled("block-detail-next-0xtarget")).toBe(false);
    fireEvent.click(nextButton);
    expect(onNavigate).toHaveBeenCalledWith("0xchild");
    expect(screen.queryByTestId("block-detail-next-reason")).toBeNull();
  });

  it("disables 'next block' and shows the 'latest block' reason when isLatest is true", () => {
    const target = block({ hash: "0xtarget" });
    renderView({
      block: target,
      navigation: navigation({ child: undefined, isLatest: true }),
    });
    expect(isDisabled("block-detail-next-0xtarget")).toBe(true);
    expect(screen.getByTestId("block-detail-next-reason").textContent).toBe(
      "最新のブロックです",
    );
  });

  it("disables 'next block' and shows the generic 'not found' reason when isLatest is false", () => {
    const target = block({ hash: "0xtarget" });
    renderView({
      block: target,
      navigation: navigation({ child: undefined, isLatest: false }),
    });
    expect(isDisabled("block-detail-next-0xtarget")).toBe(true);
    expect(screen.getByTestId("block-detail-next-reason").textContent).toBe(
      "次のブロックが見つかりません",
    );
  });

  it("disables both directions and shows both reasons for an isolated block (no parent, no child)", () => {
    // 保持窓に対象ブロック1件しか無い（親も子も観測されていない）境界。
    // 前後どちらのボタンも無効になり、両方向の理由文言が同時に出る。
    const target = block({ hash: "0xisolated" });
    renderView({
      block: target,
      navigation: navigation({ parent: undefined, child: undefined, isLatest: false }),
    });
    expect(isDisabled("block-detail-prev-0xisolated")).toBe(true);
    expect(isDisabled("block-detail-next-0xisolated")).toBe(true);
    expect(screen.getByTestId("block-detail-prev-reason").textContent).toBe(
      "これより前は保持期間外のため表示できません",
    );
    expect(screen.getByTestId("block-detail-next-reason").textContent).toBe(
      "次のブロックが見つかりません",
    );
  });
});

describe("BlockDetailView: transaction list", () => {
  it("shows the empty-block message when there are no included transactions", () => {
    renderView({ visibleTransactions: [], totalTxCount: 0 });
    expect(screen.getByText("0（空ブロック）")).toBeTruthy();
  });

  it("renders each visible transaction's hash, nonce, from/to, and status", () => {
    const included = tx({
      hash: "0xtxhash000000000000000000000000000001",
      nonce: 3,
      status: "included",
    });
    renderView({ visibleTransactions: [included], totalTxCount: 1 });
    const row = screen.getByTestId(`block-detail-tx-${included.hash}`);
    expect(row).toBeTruthy();
    expect(screen.getByTestId(`block-detail-tx-nonce-${included.hash}`).textContent).toContain(
      "3",
    );
    expect(screen.getByText("取り込み済み")).toBeTruthy();
  });

  it("omits the nonce field for a transaction without an observed nonce", () => {
    const noNonce = tx({ hash: "0xtxnononce00000000000000000000000001" });
    renderView({ visibleTransactions: [noNonce], totalTxCount: 1 });
    expect(screen.queryByTestId(`block-detail-tx-nonce-${noNonce.hash}`)).toBeNull();
  });

  it("shows the deploy label instead of a 'to' address for contract-creation transactions", () => {
    const deploy = tx({ hash: "0xdeploytx000000000000000000000000001", to: null });
    renderView({ visibleTransactions: [deploy], totalTxCount: 1 });
    expect(screen.getByText(/デプロイ/)).toBeTruthy();
  });

  it("shows the function-call preview with a resolved contract name when contractCall is present", () => {
    const contractAddress = `0x${"c".repeat(40)}`;
    const call = tx({
      hash: "0xcalltx0000000000000000000000000000001",
      contractCall: { contractAddress, functionName: "transfer", args: [] },
    });
    const contractsByAddress = new Map<string, ContractEntity>([
      [contractAddress, { kind: "contract", address: contractAddress, chainType: "ethereum", name: "ChainvizToken" }],
    ]);
    renderView({
      visibleTransactions: [call],
      totalTxCount: 1,
      contractsByAddress,
    });
    const callCell = screen.getByTestId(`block-detail-tx-call-${call.hash}`);
    expect(callCell.textContent).toContain("transfer");
    expect(callCell.textContent).toContain("ChainvizToken");
  });

  it("falls back to the shortened contract address when the target contract name is not resolvable", () => {
    // 宛先コントラクトが catalog に無い（未観測・別 tx で観測されただけ 等）
    // 場合、名前ではなく shortHex(アドレス) にフォールバックする
    // （deriveTxCallPreview の契約。resolved 名の表示は別テストで確認済み）。
    const contractAddress = `0x${"d".repeat(40)}`;
    const call = tx({
      hash: "0xcalltx0000000000000000000000000000002",
      contractCall: { contractAddress, functionName: "approve", args: [] },
    });
    renderView({
      visibleTransactions: [call],
      totalTxCount: 1,
      contractsByAddress: new Map<string, ContractEntity>(),
    });
    const callCell = screen.getByTestId(`block-detail-tx-call-${call.hash}`);
    expect(callCell.textContent).toContain("approve");
    expect(callCell.textContent).toContain("0xdddddd");
  });

  it("shows an overflow message when overflowCount is greater than zero", () => {
    renderView({
      visibleTransactions: [tx({ hash: "0x1" })],
      totalTxCount: 5,
      overflowCount: 3,
    });
    expect(screen.getByTestId("block-detail-tx-overflow").textContent).toBe("他 3 件");
  });

  it("does not show an overflow message when overflowCount is zero", () => {
    renderView({ visibleTransactions: [tx({ hash: "0x1" })], totalTxCount: 1, overflowCount: 0 });
    expect(screen.queryByTestId("block-detail-tx-overflow")).toBeNull();
  });
});
