// SidePanelHost の "blockDetail" kind への振り分け（Issue #409）と、対象
// ブロックが保持窓から外れたときのダングリングガードのテスト。他 kind の
// 振り分け・排他遷移は既存の SidePanelHost.test.tsx / .kindSwitch.test.tsx
// が扱うため、ここでは blockDetail に固有の関心事に絞る
// （CLAUDE.md のテスト分割方針）。
import type { BlockEntity, ContractEntity, TransactionEntity } from "@chainviz/shared";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider, useSidePanel } from "./SidePanelContext.js";
import { SidePanelHost } from "./SidePanelHost.js";

afterEach(cleanup);

const noopCommsLog = {
  visibleEntries: [],
  filters: { categories: {} as never, nodeId: null },
  toggleCategory: () => {},
  setNodeFilter: () => {},
};

function block(overrides: Partial<BlockEntity> & { hash: string }): BlockEntity {
  return {
    kind: "block",
    number: 10,
    parentHash: "0xparent",
    timestamp: 1_700_000_000,
    receivedAt: {},
    ...overrides,
  };
}

function OpenButton({ hash }: { hash: string }) {
  const { open } = useSidePanel();
  return (
    <button type="button" onClick={() => open({ kind: "blockDetail", hash })}>
      open
    </button>
  );
}

function renderHost(options: {
  blocksByHash: ReadonlyMap<string, BlockEntity>;
  hash: string;
  latestBlockHash?: string;
  transactions?: TransactionEntity[];
}) {
  return render(
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={{}}>
        <SidePanelProvider>
          <OpenButton hash={options.hash} />
          <SidePanelHost
            contractsByAddress={new Map<string, ContractEntity>()}
            commsLog={noopCommsLog}
            commsLogNodeOptions={[]}
            layerFilter="all"
            onLayerFilterChange={() => {}}
            blocksByHash={options.blocksByHash}
            latestBlockHash={options.latestBlockHash}
            transactions={options.transactions}
          />
        </SidePanelProvider>
      </GlossaryProvider>
    </LanguageProvider>,
  );
}

describe("SidePanelHost: blockDetail dispatch", () => {
  it("renders the block detail panel for a hash present in blocksByHash", () => {
    const target = block({ hash: "0xtarget", number: 55 });
    renderHost({ blocksByHash: new Map([[target.hash, target]]), hash: target.hash });
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByTestId("side-panel")).toBeTruthy();
    expect(screen.getByTestId("block-detail-view")).toBeTruthy();
    expect(screen.getByText("#55")).toBeTruthy();
  });

  it("closes automatically when the target hash has no matching block (dangling guard)", () => {
    renderHost({ blocksByHash: new Map(), hash: "0xnonexistent" });
    fireEvent.click(screen.getByText("open"));
    expect(screen.queryByTestId("side-panel")).toBeNull();
  });

  it("closes an already-open panel when its target block falls out of the retention window on a later render", () => {
    const target = block({ hash: "0xtarget" });
    const withBlock = new Map([[target.hash, target]]);
    const { rerender } = render(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <SidePanelProvider>
            <OpenButton hash={target.hash} />
            <SidePanelHost
              contractsByAddress={new Map<string, ContractEntity>()}
              commsLog={noopCommsLog}
              commsLogNodeOptions={[]}
              layerFilter="all"
              onLayerFilterChange={() => {}}
              blocksByHash={withBlock}
            />
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByTestId("side-panel")).toBeTruthy();

    rerender(
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <SidePanelProvider>
            <OpenButton hash={target.hash} />
            <SidePanelHost
              contractsByAddress={new Map<string, ContractEntity>()}
              commsLog={noopCommsLog}
              commsLogNodeOptions={[]}
              layerFilter="all"
              onLayerFilterChange={() => {}}
              blocksByHash={new Map()}
            />
          </SidePanelProvider>
        </GlossaryProvider>
      </LanguageProvider>,
    );
    expect(screen.queryByTestId("side-panel")).toBeNull();
  });

  it("navigates to the parent block when 'previous block' is clicked, replacing the displayed content in place", () => {
    const parent = block({ hash: "0xparent", number: 9 });
    const target = block({ hash: "0xtarget", number: 10, parentHash: "0xparent" });
    const blocksByHash = new Map([
      [parent.hash, parent],
      [target.hash, target],
    ]);
    renderHost({ blocksByHash, hash: target.hash });
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByText("#10")).toBeTruthy();

    fireEvent.click(screen.getByTestId(`block-detail-prev-${target.hash}`));
    expect(screen.getByText("#9")).toBeTruthy();
    expect(screen.queryByText("#10")).toBeNull();
    // 1枚のパネルのまま中身だけが差し替わる（新しいパネルが重ねて開かない）。
    expect(screen.getAllByTestId("side-panel")).toHaveLength(1);
  });

  it("navigates to the parent block when the parent-hash field link is clicked (a second entry point besides the prev button)", () => {
    const parent = block({ hash: "0xparent", number: 9 });
    const target = block({ hash: "0xtarget", number: 10, parentHash: "0xparent" });
    const blocksByHash = new Map([
      [parent.hash, parent],
      [target.hash, target],
    ]);
    renderHost({ blocksByHash, hash: target.hash });
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByText("#10")).toBeTruthy();

    fireEvent.click(screen.getByTestId(`block-detail-parent-link-${target.hash}`));
    expect(screen.getByText("#9")).toBeTruthy();
    expect(screen.getAllByTestId("side-panel")).toHaveLength(1);
  });

  it("disables 'next block' with the latest-block reason when the target hash matches latestBlockHash", () => {
    const target = block({ hash: "0xtarget", number: 10 });
    renderHost({
      blocksByHash: new Map([[target.hash, target]]),
      hash: target.hash,
      latestBlockHash: target.hash,
    });
    fireEvent.click(screen.getByText("open"));
    const nextButton = screen.getByTestId(
      `block-detail-next-${target.hash}`,
    ) as HTMLButtonElement;
    expect(nextButton.disabled).toBe(true);
    expect(screen.getByTestId("block-detail-next-reason").textContent).toBe(
      "最新のブロックです",
    );
  });

  it("filters the transactions list to only those belonging to the displayed block", () => {
    const target = block({ hash: "0xtarget" });
    const included: TransactionEntity = {
      kind: "transaction",
      hash: "0xtx-in-block",
      from: "0xfrom",
      to: "0xto",
      status: "included",
      blockHash: target.hash,
    };
    const other: TransactionEntity = {
      kind: "transaction",
      hash: "0xtx-other-block",
      from: "0xfrom",
      to: "0xto",
      status: "included",
      blockHash: "0xother",
    };
    renderHost({
      blocksByHash: new Map([[target.hash, target]]),
      hash: target.hash,
      transactions: [included, other],
    });
    fireEvent.click(screen.getByText("open"));
    expect(screen.getByTestId(`block-detail-tx-${included.hash}`)).toBeTruthy();
    expect(screen.queryByTestId(`block-detail-tx-${other.hash}`)).toBeNull();
  });
});
