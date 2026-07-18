import type { ContractEntity, TransactionEntity, WalletEntity } from "@chainviz/shared";
import { ReactFlowProvider } from "@xyflow/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GlossaryProvider } from "../glossary/GlossaryProvider.js";
import { LanguageProvider } from "../i18n/LanguageProvider.js";
import { RibbonHoverProvider } from "./RibbonHoverContext.js";
import { WalletCard } from "./WalletCard.js";
import type { WalletFlowNode } from "./walletNode.js";

afterEach(cleanup);

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

function tx(
  hash: string,
  status: TransactionEntity["status"],
): TransactionEntity {
  return { kind: "transaction", hash, from: "0xa", to: "0xb", status };
}

function renderTree(data: WalletFlowNode["data"]) {
  const props = { data } as unknown as Parameters<typeof WalletCard>[0];
  return (
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
    </ReactFlowProvider>
  );
}

// Issue #388: 属性の状態遷移（pending → included）を確認するテストが
// rerender できるよう、render 結果をそのまま返す（既存の呼び出しは戻り値を
// 使わないため非破壊）。
function renderCard(data: WalletFlowNode["data"]) {
  return render(renderTree(data));
}

function data(overrides: Partial<WalletFlowNode["data"]> = {}): WalletFlowNode["data"] {
  return {
    entity: wallet(),
    transactions: [],
    popoverTransactions: [],
    settlingHashes: [],
    ownerPresent: true,
    contractsByAddress: new Map(),
    ...overrides,
  };
}

describe("WalletCard", () => {
  it("shows the shortened address and ether balance", () => {
    renderCard(data());
    expect(screen.getByText("0xaaaaaa…aaaa")).toBeTruthy();
    expect(screen.getByText(/3\.0000 ETH/)).toBeTruthy();
  });

  it("renders a tx chip carrying the status as a data attribute", () => {
    const t = tx("0xdeadbeef00000000", "pending");
    renderCard(data({ entity: wallet({ recentTxHashes: [t.hash] }), transactions: [t] }));
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.getAttribute("data-status")).toBe("pending");
  });

  it("does not render data-block-hash on a pending tx chip (Issue #388)", () => {
    const t = tx("0xdeadbeef00000000", "pending");
    renderCard(data({ entity: wallet({ recentTxHashes: [t.hash] }), transactions: [t] }));
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.hasAttribute("data-block-hash")).toBe(false);
  });

  it("exposes the full blockHash via data-block-hash once the tx is included (Issue #388)", () => {
    const t = {
      ...tx("0xabc1230000000000", "included"),
      blockHash: `0x${"f".repeat(64)}`,
    };
    renderCard(data({ entity: wallet({ recentTxHashes: [t.hash] }), transactions: [t] }));
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.getAttribute("data-block-hash")).toBe(t.blockHash);
  });

  it("adds the settling class to a tx currently in the settling set", () => {
    const t = tx("0xabc1230000000000", "included");
    renderCard(
      data({
        entity: wallet({ recentTxHashes: [t.hash] }),
        transactions: [t],
        settlingHashes: [t.hash],
      }),
    );
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.className).toContain("is-settling");
  });

  it("shows an owner-deleted badge when the owner is absent", () => {
    renderCard(
      data({
        entity: wallet({ ownerWorkbenchId: null }),
        ownerPresent: false,
      }),
    );
    expect(screen.getByTestId(`wallet-orphan-${wallet().address}`)).toBeTruthy();
  });

  it("does not show the owner-deleted badge when the owner is present", () => {
    renderCard(data({ ownerPresent: true }));
    expect(
      screen.queryByTestId(`wallet-orphan-${wallet().address}`),
    ).toBeNull();
  });

  it("labels a smart account differently from an EOA", () => {
    renderCard(data({ entity: wallet({ isSmartAccount: true }) }));
    expect(screen.getByText("スマートアカウント")).toBeTruthy();
  });
});

// Issue #388: TxChip の `data-block-hash` は UI-B-06 が対象タイルを逆引き
// せず直接特定するための計装。e2e 側は `data-status="included"` のチップを
// 掴んでから `data-block-hash` を読み、空なら throw するガードを持つ
// （chain-ribbon.spec.ts）。その前提となる「属性の有無は blockHash の有無
// だけで決まる」「完全な hash が一意に載る」を境界・遷移の観点で固定する。
describe("WalletCard tx chip data-block-hash (Issue #388)", () => {
  const INCLUDED_BLOCK_HASH = `0x${"f".repeat(64)}`;

  function includedTx(
    hash: string,
    blockHash: string | undefined,
  ): TransactionEntity {
    return {
      kind: "transaction",
      hash,
      from: "0xa",
      to: "0xb",
      status: "included",
      ...(blockHash === undefined ? {} : { blockHash }),
    };
  }

  it("omits data-block-hash on an included tx that still lacks a blockHash", () => {
    // 属性の有無は status ではなく blockHash の有無で決まる。included でも
    // blockHash 未確定（collector が block 突き合わせ前の一瞬など）なら
    // 属性は出ず、e2e 側の空チェック（?? "" → throw）が意味を持つ。
    const t = includedTx("0xabc1230000000000", undefined);
    renderCard(data({ entity: wallet({ recentTxHashes: [t.hash] }), transactions: [t] }));
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.getAttribute("data-status")).toBe("included");
    expect(chip.hasAttribute("data-block-hash")).toBe(false);
  });

  it("starts blockHash-less on a pending tx and gains the full hash once included (rerender)", () => {
    const hash = "0xlifecycle0000000";
    const pending: TransactionEntity = {
      kind: "transaction",
      hash,
      from: "0xa",
      to: "0xb",
      status: "pending",
    };
    const { rerender } = renderCard(
      data({ entity: wallet({ recentTxHashes: [hash] }), transactions: [pending] }),
    );
    const before = screen.getByTestId(`wallet-tx-chip-${hash}`);
    expect(before.hasAttribute("data-block-hash")).toBe(false);

    // 同一チップが pending → included に遷移した瞬間、属性が「無し → 完全な
    // hash」へ切り替わる（マウントし直しではなく状態更新として確認）。
    rerender(
      renderTree(
        data({
          entity: wallet({ recentTxHashes: [hash] }),
          transactions: [includedTx(hash, INCLUDED_BLOCK_HASH)],
        }),
      ),
    );
    const after = screen.getByTestId(`wallet-tx-chip-${hash}`);
    expect(after.getAttribute("data-block-hash")).toBe(INCLUDED_BLOCK_HASH);
  });

  it("carries a distinct full blockHash per chip so the exact-match selector is unique", () => {
    // e2e は `[data-block-hash="<hash>"]` の完全一致で1件だけ掴む。複数の
    // included tx が別々のブロックに載っている場合でも、各チップが自分の
    // 値のみを持ち混線しないことを確認する。
    const hashA = `0x${"a".repeat(64)}`;
    const hashB = `0x${"b".repeat(64)}`;
    const txA = includedTx("0xtxa0000000000000", hashA);
    const txB = includedTx("0xtxb0000000000000", hashB);
    renderCard(
      data({
        entity: wallet({ recentTxHashes: [txA.hash, txB.hash] }),
        transactions: [txA, txB],
      }),
    );
    const chipA = screen.getByTestId(`wallet-tx-chip-${txA.hash}`);
    const chipB = screen.getByTestId(`wallet-tx-chip-${txB.hash}`);
    expect(chipA.getAttribute("data-block-hash")).toBe(hashA);
    expect(chipB.getAttribute("data-block-hash")).toBe(hashB);
    // 完全な hash（0x + 64桁）であること。短縮 hash では e2e の
    // blockHash 直接特定が成立しない。
    expect(chipA.getAttribute("data-block-hash")).toHaveLength(66);
  });
});

describe("WalletCard token balances (ARCHITECTURE.md §6.7)", () => {
  function contract(overrides: Partial<ContractEntity> = {}): ContractEntity {
    return {
      kind: "contract",
      address: `0x${"c".repeat(40)}`,
      chainType: "ethereum",
      ...overrides,
    };
  }

  it("does not render the token balances section when tokenBalances is absent", () => {
    renderCard(data());
    expect(
      screen.queryByTestId(`wallet-tokens-${wallet().address}`),
    ).toBeNull();
  });

  it("does not render the token balances section when tokenBalances is empty", () => {
    renderCard(data({ entity: wallet({ tokenBalances: [] }) }));
    expect(
      screen.queryByTestId(`wallet-tokens-${wallet().address}`),
    ).toBeNull();
  });

  it("shows a formatted token balance chip when the contract is resolvable", () => {
    const tokenAddress = `0x${"d".repeat(40)}`;
    renderCard(
      data({
        entity: wallet({
          tokenBalances: [
            { contractAddress: tokenAddress, amount: (5n * 10n ** 18n).toString() },
          ],
        }),
        contractsByAddress: new Map([
          [
            tokenAddress,
            contract({
              address: tokenAddress,
              name: "ChainvizToken",
              token: { symbol: "CVZDEMO", decimals: 18 },
            }),
          ],
        ]),
      }),
    );
    const chip = screen.getByTestId(
      `wallet-token-chip-${wallet().address}-${tokenAddress}`,
    );
    expect(chip.textContent).toBe("5.0000 CVZDEMO");
  });

  it("distinguishes two same-named token contracts by address in the chip title (Issue #218 派生)", () => {
    const addressA = `0x${"d".repeat(40)}`;
    const addressB = `0x${"e".repeat(40)}`;
    renderCard(
      data({
        entity: wallet({
          tokenBalances: [
            { contractAddress: addressA, amount: "0" },
            { contractAddress: addressB, amount: "0" },
          ],
        }),
        contractsByAddress: new Map([
          [
            addressA,
            contract({
              address: addressA,
              name: "ChainvizToken",
              token: { symbol: "CVZDEMO", decimals: 18 },
            }),
          ],
          [
            addressB,
            contract({
              address: addressB,
              name: "ChainvizToken",
              token: { symbol: "CVZDEMO", decimals: 18 },
            }),
          ],
        ]),
      }),
    );
    const chipA = screen.getByTestId(
      `wallet-token-chip-${wallet().address}-${addressA}`,
    );
    const chipB = screen.getByTestId(
      `wallet-token-chip-${wallet().address}-${addressB}`,
    );
    expect(chipA.title).not.toBe(chipB.title);
    expect(chipA.title).toContain("ChainvizToken");
  });

  it("does not render a chip for a tokenBalance whose ContractEntity is unresolved (dangling guard)", () => {
    const tokenAddress = `0x${"d".repeat(40)}`;
    renderCard(
      data({
        entity: wallet({
          tokenBalances: [{ contractAddress: tokenAddress, amount: "1000" }],
        }),
        contractsByAddress: new Map(),
      }),
    );
    expect(
      screen.queryByTestId(`wallet-tokens-${wallet().address}`),
    ).toBeNull();
    expect(
      screen.queryByTestId(`wallet-token-chip-${wallet().address}-${tokenAddress}`),
    ).toBeNull();
  });
});

describe("WalletCard tx chip label priority (ARCHITECTURE.md §6.6)", () => {
  it("prefers the decoded function name over the tx hash", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xcall00000000000000000000000000000000000000000000000000000000",
      from: "0xa",
      to: "0xtoken",
      status: "included",
      contractCall: { contractAddress: "0xtoken", functionName: "transfer" },
    };
    renderCard(
      data({ entity: wallet({ recentTxHashes: [t.hash] }), transactions: [t] }),
    );
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.textContent).toBe("transfer");
    expect(chip.getAttribute("data-label-kind")).toBe("function");
  });

  it("labels a deploy tx (createdContractAddress) as 'デプロイ' when no function name is decoded", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xdeploy0000000000000000000000000000000000000000000000000000000",
      from: "0xa",
      to: null,
      status: "included",
      createdContractAddress: "0xnewcontract",
    };
    renderCard(
      data({ entity: wallet({ recentTxHashes: [t.hash] }), transactions: [t] }),
    );
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.textContent).toBe("デプロイ");
    expect(chip.getAttribute("data-label-kind")).toBe("deploy");
  });

  it("falls back to a shortened rawFunctionId when the call cannot be decoded", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xraw000000000000000000000000000000000000000000000000000000000",
      from: "0xa",
      to: "0xunknown",
      status: "included",
      contractCall: { contractAddress: "0xunknown", rawFunctionId: "0xa9059cbb" },
    };
    renderCard(
      data({ entity: wallet({ recentTxHashes: [t.hash] }), transactions: [t] }),
    );
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.textContent).toBe("0xa9059cbb");
    expect(chip.getAttribute("data-label-kind")).toBe("raw");
  });

  it("falls back to the shortened tx hash for a plain transfer with no contract info", () => {
    const t: TransactionEntity = {
      kind: "transaction",
      hash: "0xplain0000000000000000000000000000000000000000000000000000000",
      from: "0xa",
      to: "0xb",
      status: "pending",
    };
    renderCard(
      data({ entity: wallet({ recentTxHashes: [t.hash] }), transactions: [t] }),
    );
    const chip = screen.getByTestId(`wallet-tx-chip-${t.hash}`);
    expect(chip.textContent).toBe("0xplai…000");
    expect(chip.getAttribute("data-label-kind")).toBe("hash");
  });
});
