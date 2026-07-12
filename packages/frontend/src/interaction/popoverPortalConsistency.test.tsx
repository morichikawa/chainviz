import type {
  ContractEntity,
  NodeEntity,
  TransactionEntity,
  WalletEntity,
} from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ActionHint } from "../canvas/ActionHint.js";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { GlossaryTerm } from "../glossary/GlossaryTerm.js";
import type { Glossary } from "../glossary/types.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import type { ContractActivityChip } from "../entities/contractActivity.js";
import type { ContractFlowNode } from "../entities/contractNode.js";
import { ContractCard } from "../entities/ContractCard.js";
import { ContractPopover } from "../entities/ContractPopover.js";
import type { InfraEntity } from "../entities/infraNode.js";
import { InfraPopover } from "../entities/InfraPopover.js";
import { RibbonHoverProvider } from "../entities/RibbonHoverContext.js";
import { TxLifecyclePopover } from "../entities/TxLifecyclePopover.js";
import { WalletCard } from "../entities/WalletCard.js";
import type { WalletFlowNode } from "../entities/walletNode.js";
import { WalletPopover } from "../entities/WalletPopover.js";

afterEach(cleanup);

/**
 * Issue #245 の核心（全ホバーポップオーバーを `document.body` 直下へ portal 描画
 * してノードのスタッキングコンテキストから脱出させる）が、対象8箇所すべてに
 * 一貫して適用されていることを固定する横断テスト。将来ポップオーバーを追加/
 * 変更した際に「portal し忘れて隣接カードの下に隠れる」退行を検出する目的。
 *
 * 各ケースは「開いたポップオーバー要素が RTL の描画コンテナ（各カード/要素の
 * ローカルなサブツリー）の外にあり、かつ `document.body` 配下にある」ことを
 * 確認する。ローカルなサブツリー内に描画されていると（＝portal されていないと）
 * `container.contains(popover)` が真になり、このテストが落ちる。
 */

/** 開いているポップオーバー要素が container の外・body 配下に portal されていることを検証する。 */
function expectPortaledOutside(container: HTMLElement, popover: HTMLElement): void {
  expect(document.body.contains(popover)).toBe(true);
  expect(container.contains(popover)).toBe(false);
}

const glossary: Glossary = {
  container: {
    key: "container",
    name: { ja: "コンテナ", en: "Container" },
    definition: { ja: "隔離された実行単位", en: "An isolated runtime unit" },
    layer: "a-infra",
    relatedTerms: [],
  },
};

function providers(node: React.ReactNode, withReactFlow = false) {
  const inner = (
    <LanguageProvider initialLanguage="ja">
      <GlossaryProvider glossary={glossary}>
        {/* Issue #298: WalletCard/ContractCard は RibbonHoverContext を読む
            ため、他のケースに影響が無い共通の Provider をここに置く。 */}
        <RibbonHoverProvider transactions={[]}>{node}</RibbonHoverProvider>
      </GlossaryProvider>
    </LanguageProvider>
  );
  return withReactFlow ? <ReactFlowProvider>{inner}</ReactFlowProvider> : inner;
}

function anchor(): { current: HTMLElement | null } {
  return { current: document.createElement("div") };
}

const node: NodeEntity = {
  kind: "node",
  id: "reth-1",
  containerName: "chainviz-reth-1",
  ip: "172.20.0.11",
  ports: [8545],
  resources: { cpuPercent: 1.2, memMB: 100 },
  process: { name: "reth node", version: "1.0.0" },
  chainType: "ethereum",
  clientType: "reth",
  syncStatus: "synced",
  blockHeight: 10,
  headBlockHash: "0xabc",
  removable: true,
};

function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
  return {
    kind: "contract",
    address: `0x${"c".repeat(40)}`,
    chainType: "ethereum",
    ...overrides,
  };
}

function wallet(overrides: Partial<WalletEntity> = {}): WalletEntity {
  return {
    kind: "wallet",
    address: `0x${"a".repeat(40)}`,
    chainType: "ethereum",
    balance: (2n * 10n ** 18n).toString(),
    nonce: 1,
    isSmartAccount: false,
    ownerWorkbenchId: "workbench-alice",
    recentTxHashes: [],
    ...overrides,
  };
}

function tx(hash: string): TransactionEntity {
  return { kind: "transaction", hash, from: "0xa", to: "0xb", status: "pending" };
}

describe("PopoverPortal is applied consistently to all 8 hover popovers (Issue #245)", () => {
  it("1. ActionHint tooltip portals out of its local subtree", () => {
    const { container } = render(
      providers(
        <ActionHint hint="hint text">
          <button type="button">Do it</button>
        </ActionHint>,
      ),
    );
    fireEvent.mouseEnter(screen.getByRole("button").parentElement as HTMLElement);
    expectPortaledOutside(container, screen.getByRole("tooltip"));
  });

  it("2. GlossaryTerm definition popover portals out of its local subtree", () => {
    const { container } = render(
      providers(<GlossaryTerm termKey="container">コンテナ</GlossaryTerm>),
    );
    fireEvent.mouseEnter(screen.getByRole("button"));
    expectPortaledOutside(container, screen.getByRole("tooltip"));
  });

  it("3. InfraPopover portals out of its local subtree", () => {
    const { container } = render(
      providers(<InfraPopover anchorRef={anchor()} entity={node as InfraEntity} />),
    );
    expectPortaledOutside(container, screen.getByTestId(`infra-popover-${node.id}`));
  });

  it("4. ContractPopover portals out of its local subtree", () => {
    const { container } = render(
      providers(<ContractPopover anchorRef={anchor()} entity={contract()} />),
    );
    expectPortaledOutside(container, screen.getByRole("tooltip"));
  });

  it("5. WalletPopover portals out of its local subtree", () => {
    const { container } = render(
      providers(
        <WalletPopover anchorRef={anchor()} entity={wallet()} transactions={[]} />,
      ),
    );
    expectPortaledOutside(container, screen.getByRole("tooltip"));
  });

  it("6. TxLifecyclePopover portals out of its local subtree", () => {
    const t = tx("0xdeadbeef00000000");
    const { container } = render(
      providers(<TxLifecyclePopover anchorRef={anchor()} tx={t} />),
    );
    expectPortaledOutside(
      container,
      screen.getByTestId(`tx-lifecycle-popover-${t.hash}`),
    );
  });

  it("7. ContractCard activity chip popover portals out of the card subtree", () => {
    const chip: ContractActivityChip = {
      key: "chip-1",
      kind: "call",
      label: "transfer",
      decoded: false,
      args: [],
      txHash: "0xfeed000000000000",
    };
    const data = { entity: contract(), activity: [chip] } as ContractFlowNode["data"];
    const props = { data } as unknown as Parameters<typeof ContractCard>[0];
    const { container } = render(providers(<ContractCard {...props} />, true));

    fireEvent.mouseEnter(screen.getByTestId(`contract-activity-chip-${chip.key}`));
    const popover = document.body.querySelector(
      ".contract-activity-chip__popover",
    ) as HTMLElement | null;
    expect(popover).not.toBeNull();
    expectPortaledOutside(container, popover as HTMLElement);
  });

  it("8. WalletCard tx chip lifecycle popover portals out of the card subtree", () => {
    const t = tx("0xcafe000000000000");
    const data = {
      entity: wallet({ recentTxHashes: [t.hash] }),
      transactions: [t],
      settlingHashes: [],
      ownerPresent: true,
      contractsByAddress: new Map(),
    } as WalletFlowNode["data"];
    const props = { data } as unknown as Parameters<typeof WalletCard>[0];
    const { container } = render(providers(<WalletCard {...props} />, true));

    fireEvent.mouseEnter(screen.getByTestId(`wallet-tx-chip-${t.hash}`));
    expectPortaledOutside(
      container,
      screen.getByTestId(`tx-lifecycle-popover-${t.hash}`),
    );
  });
});
