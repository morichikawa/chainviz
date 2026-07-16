import type {
  BlockEntity,
  ContractEntity,
  TransactionEntity,
  WalletEntity,
} from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChainRibbonCard } from "./ChainRibbonCard.js";
import type { ChainRibbonTile } from "./chainRibbon.js";
import type { ChainRibbonFlowNode } from "./chainRibbonNode.js";
import { ContractCard } from "./ContractCard.js";
import type { ContractFlowNode } from "./contractNode.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { SidePanelProvider } from "../side-panel/SidePanelContext.js";
import { RibbonHoverProvider } from "./RibbonHoverContext.js";
import { WalletCard } from "./WalletCard.js";
import type { WalletFlowNode } from "./walletNode.js";

afterEach(cleanup);

/**
 * Issue #298 第2段階（タイルホバー連動ハイライト）の、実際のカード合成での
 * 挙動を確認する結合テスト。`ChainRibbonCard.test.tsx`（リボン単体の見た目・
 * 相互作用）・`RibbonHoverContext.test.tsx`（純粋な状態遷移）とは別に、
 * 「リボンのタイルをホバーするとウォレット/コントラクトカードが光る」
 * 「tx チップをホバーするとリボンのタイルが光る」という双方向の連動を、
 * 3種類のカードを同一 Provider 配下に並べた状態で確認する。
 */

const WALLET_ADDRESS = `0x${"a".repeat(40)}`;
const CONTRACT_ADDRESS = `0x${"c".repeat(40)}`;
const BLOCK_HASH = "0xb1";

function wallet(): WalletEntity {
  return {
    kind: "wallet",
    address: WALLET_ADDRESS,
    chainType: "ethereum",
    balance: "0",
    nonce: 0,
    isSmartAccount: false,
    ownerWorkbenchId: null,
    recentTxHashes: [TX_HASH],
  };
}

function contract(): ContractEntity {
  return { kind: "contract", address: CONTRACT_ADDRESS, chainType: "ethereum" };
}

const TX_HASH = "0xdeadbeef00000000";

function tx(): TransactionEntity {
  return {
    kind: "transaction",
    hash: TX_HASH,
    from: WALLET_ADDRESS,
    to: CONTRACT_ADDRESS,
    status: "included",
    blockHash: BLOCK_HASH,
    contractCall: { contractAddress: CONTRACT_ADDRESS, functionName: "transfer" },
  };
}

function block(): BlockEntity {
  return {
    kind: "block",
    hash: BLOCK_HASH,
    number: 5,
    parentHash: "0xparent",
    timestamp: 0,
    receivedAt: {},
  };
}

function ribbonData(): ChainRibbonFlowNode["data"] {
  const tile: ChainRibbonTile = { block: block(), connectedToPrevious: false };
  return {
    tiles: [tile],
    txCountByHash: new Map([[BLOCK_HASH, 1]]),
    nodeLabelById: new Map(),
    landingHashes: new Set(),
    blocks: [tile.block],
  };
}

function walletData(): WalletFlowNode["data"] {
  return {
    entity: wallet(),
    transactions: [tx()],
    popoverTransactions: [tx()],
    settlingHashes: [],
    ownerPresent: true,
    contractsByAddress: new Map(),
  };
}

function contractData(): ContractFlowNode["data"] {
  return {
    entity: contract(),
    activity: [
      {
        key: `${TX_HASH}-call`,
        kind: "call",
        label: "transfer",
        decoded: true,
        args: [],
        txHash: TX_HASH,
      },
    ],
  };
}

function renderScene() {
  const ribbonProps = { data: ribbonData() } as unknown as Parameters<
    typeof ChainRibbonCard
  >[0];
  const walletProps = { data: walletData() } as unknown as Parameters<
    typeof WalletCard
  >[0];
  const contractProps = { data: contractData() } as unknown as Parameters<
    typeof ContractCard
  >[0];

  return render(
    <ReactFlowProvider>
      <LanguageProvider initialLanguage="ja">
        <GlossaryProvider glossary={{}}>
          <RibbonHoverProvider transactions={[tx()]}>
            {/* Issue #321: ContractCard は SidePanelContext を読むため、
                テストでも Provider 配下でレンダーする必要がある
                （ContractCard.test.tsx と同じ理由）。 */}
            <SidePanelProvider>
              <ChainRibbonCard {...ribbonProps} />
              <WalletCard {...walletProps} />
              <ContractCard {...contractProps} />
            </SidePanelProvider>
          </RibbonHoverProvider>
        </GlossaryProvider>
      </LanguageProvider>
    </ReactFlowProvider>,
  );
}

describe("chain ribbon cross-card hover highlight (Issue #298 second stage)", () => {
  it("forward: hovering the tile highlights both the wallet and contract cards involved in that block", () => {
    renderScene();
    const walletCard = screen.getByTestId(`wallet-card-${WALLET_ADDRESS}`);
    const contractCard = screen.getByTestId(`contract-card-${CONTRACT_ADDRESS}`);
    expect(walletCard.className).not.toContain("infra-card--ribbon-highlight");
    expect(contractCard.className).not.toContain("infra-card--ribbon-highlight");

    fireEvent.mouseEnter(screen.getByTestId(`chain-ribbon-tile-${BLOCK_HASH}`));
    expect(walletCard.className).toContain("infra-card--ribbon-highlight");
    expect(contractCard.className).toContain("infra-card--ribbon-highlight");

    fireEvent.mouseLeave(screen.getByTestId(`chain-ribbon-tile-${BLOCK_HASH}`));
    expect(walletCard.className).not.toContain("infra-card--ribbon-highlight");
    expect(contractCard.className).not.toContain("infra-card--ribbon-highlight");
  });

  it("reverse: hovering the wallet's tx chip highlights the ribbon tile for that tx's block", () => {
    renderScene();
    const tileEl = screen.getByTestId(`chain-ribbon-tile-${BLOCK_HASH}`);
    expect(tileEl.className).not.toContain("chain-ribbon-tile--highlight");

    fireEvent.mouseEnter(screen.getByTestId(`wallet-tx-chip-${TX_HASH}`));
    expect(tileEl.className).toContain("chain-ribbon-tile--highlight");

    fireEvent.mouseLeave(screen.getByTestId(`wallet-tx-chip-${TX_HASH}`));
    expect(tileEl.className).not.toContain("chain-ribbon-tile--highlight");
  });

  it("reverse: hovering the contract's activity chip highlights the ribbon tile for that tx's block", () => {
    renderScene();
    const tileEl = screen.getByTestId(`chain-ribbon-tile-${BLOCK_HASH}`);

    fireEvent.mouseEnter(screen.getByTestId(`contract-activity-chip-${TX_HASH}-call`));
    expect(tileEl.className).toContain("chain-ribbon-tile--highlight");

    fireEvent.mouseLeave(screen.getByTestId(`contract-activity-chip-${TX_HASH}-call`));
    expect(tileEl.className).not.toContain("chain-ribbon-tile--highlight");
  });

  it("reverse: hovering the wallet's tx chip also fans out to the contract card in the same block", () => {
    // 逆方向は「タイルだけ」でなく、同じブロックに属する他カードにも同時に
    // 波及する（双方向連動が単一の hoveredBlockHash に一本化されている確認）。
    renderScene();
    const contractCard = screen.getByTestId(`contract-card-${CONTRACT_ADDRESS}`);
    expect(contractCard.className).not.toContain("infra-card--ribbon-highlight");

    fireEvent.mouseEnter(screen.getByTestId(`wallet-tx-chip-${TX_HASH}`));
    expect(contractCard.className).toContain("infra-card--ribbon-highlight");

    fireEvent.mouseLeave(screen.getByTestId(`wallet-tx-chip-${TX_HASH}`));
    expect(contractCard.className).not.toContain("infra-card--ribbon-highlight");
  });

  it("forward: hovering a tile self-highlights that tile (same hoveredBlockHash drives the tile too)", () => {
    // タイルを直接ホバーすると setHoveredBlockHash が立ち、そのタイル自身も
    // 逆方向ハイライトの対象になる（順方向・逆方向が同じ状態を共有する）。
    renderScene();
    const tileEl = screen.getByTestId(`chain-ribbon-tile-${BLOCK_HASH}`);
    expect(tileEl.className).not.toContain("chain-ribbon-tile--highlight");

    fireEvent.mouseEnter(tileEl);
    expect(tileEl.className).toContain("chain-ribbon-tile--highlight");

    fireEvent.mouseLeave(tileEl);
    expect(tileEl.className).not.toContain("chain-ribbon-tile--highlight");
  });
});
