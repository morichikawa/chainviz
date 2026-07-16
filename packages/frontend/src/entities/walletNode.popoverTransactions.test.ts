import type { TransactionEntity, WalletEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { DEFAULT_RECENT_TX_LIMIT, indexTransactions } from "./transaction.js";
import { isSameWalletNode, walletsToFlowNodes } from "./walletNode.js";

/**
 * Issue #320: WalletPopover 全件表示のための `WalletNodeData.popoverTransactions`
 * を検証する。カード面用の `transactions`（`DEFAULT_RECENT_TX_LIMIT` 件まで）
 * との役割分担、および `isSameWalletNode`（Issue #119 の参照安定化）への
 * 影響を確認する（`walletNode.test.ts` 本体は既存の `transactions` の挙動に
 * 専念しているため、新フィールドの回帰はここに分離する）。
 */

function wallet(overrides: Partial<WalletEntity> = {}): WalletEntity {
  return {
    kind: "wallet",
    address: "0xabc",
    chainType: "ethereum",
    balance: "0",
    nonce: 0,
    isSmartAccount: false,
    ownerWorkbenchId: null,
    recentTxHashes: [],
    ...overrides,
  };
}

function tx(hash: string): TransactionEntity {
  return {
    kind: "transaction",
    hash,
    from: "0xa",
    to: "0xb",
    status: "included",
  };
}

function ctx(overrides: Partial<Parameters<typeof walletsToFlowNodes>[1]> = {}) {
  return {
    layout: {},
    txByHash: new Map<string, TransactionEntity>(),
    settling: new Set<string>(),
    presentInfraIds: new Set<string>(),
    contractsByAddress: new Map(),
    ...overrides,
  };
}

describe("walletsToFlowNodes popoverTransactions (Issue #320)", () => {
  it("resolves all recentTxHashes into popoverTransactions, beyond DEFAULT_RECENT_TX_LIMIT", () => {
    const hashCount = DEFAULT_RECENT_TX_LIMIT + 5;
    const hashes = Array.from({ length: hashCount }, (_, i) => `0x${i}`);
    const txs = hashes.map(tx);
    const nodes = walletsToFlowNodes(
      [wallet({ address: "0xa", recentTxHashes: hashes })],
      ctx({ txByHash: indexTransactions(txs) }),
    );
    expect(nodes[0].data.popoverTransactions).toHaveLength(hashCount);
    expect(nodes[0].data.popoverTransactions.map((t) => t.hash)).toEqual(hashes);
  });

  it("keeps the card-facing transactions capped at DEFAULT_RECENT_TX_LIMIT while popoverTransactions has all of them", () => {
    const hashCount = DEFAULT_RECENT_TX_LIMIT + 5;
    const hashes = Array.from({ length: hashCount }, (_, i) => `0x${i}`);
    const txs = hashes.map(tx);
    const nodes = walletsToFlowNodes(
      [wallet({ address: "0xa", recentTxHashes: hashes })],
      ctx({ txByHash: indexTransactions(txs) }),
    );
    expect(nodes[0].data.transactions).toHaveLength(DEFAULT_RECENT_TX_LIMIT);
    expect(nodes[0].data.popoverTransactions).toHaveLength(hashCount);
  });

  it("excludes hashes that are not (yet) resolvable, same as the card list", () => {
    const nodes = walletsToFlowNodes(
      [wallet({ address: "0xa", recentTxHashes: ["0x1", "0xmissing"] })],
      ctx({ txByHash: indexTransactions([tx("0x1")]) }),
    );
    expect(nodes[0].data.popoverTransactions.map((t) => t.hash)).toEqual(["0x1"]);
  });

  it("returns an empty popoverTransactions array for a wallet with no recentTxHashes", () => {
    const nodes = walletsToFlowNodes([wallet({ address: "0xa" })], ctx());
    expect(nodes[0].data.popoverTransactions).toEqual([]);
  });
});

describe("isSameWalletNode popoverTransactions comparison (Issue #320)", () => {
  it("returns true when popoverTransactions content is unchanged across recomputations", () => {
    const hashes = ["0x1", "0x2"];
    const entity = wallet({ address: "0xa", recentTxHashes: hashes });
    const context = ctx({ txByHash: indexTransactions(hashes.map(tx)) });
    const previous = walletsToFlowNodes([entity], context)[0];
    const next = walletsToFlowNodes([entity], context)[0];
    expect(isSameWalletNode(previous, next)).toBe(true);
  });

  it("returns false when popoverTransactions content changed even if the card-facing transactions did not", () => {
    // DEFAULT_RECENT_TX_LIMIT 件までは transactions（カード面）に含まれるが、
    // popoverTransactions はそれを超えた分まで解決する。先頭 LIMIT 件の tx
    // オブジェクト参照は previous/next で完全に使い回し、超過分の1件だけを
    // 別参照（status 変化）に差し替えることで、「card面の transactions は
    // 要素の参照まで含めて不変」という前提のもとで isSameWalletNode の
    // 判定が popoverTransactions 側の変化だけを検出できているかを確認する。
    const limitHashes = Array.from(
      { length: DEFAULT_RECENT_TX_LIMIT },
      (_, i) => `0x${i}`,
    );
    const overflowHash = `0x${DEFAULT_RECENT_TX_LIMIT}`;
    const hashes = [...limitHashes, overflowHash];
    const entity = wallet({ address: "0xa", recentTxHashes: hashes });
    // 先頭 LIMIT 件は previous/next で同一の TransactionEntity 参照を使い回す。
    const limitTxs = limitHashes.map(tx);
    const overflowTxV1 = tx(overflowHash);
    const overflowTxV2: TransactionEntity = { ...overflowTxV1, status: "failed" };
    const context = ctx();

    const previous = walletsToFlowNodes(
      [entity],
      { ...context, txByHash: indexTransactions([...limitTxs, overflowTxV1]) },
    )[0];
    const next = walletsToFlowNodes(
      [entity],
      { ...context, txByHash: indexTransactions([...limitTxs, overflowTxV2]) },
    )[0];

    // 前提: card 面の transactions は要素の参照まで含めて完全に不変。
    expect(
      previous.data.transactions.every((t, i) => t === next.data.transactions[i]),
    ).toBe(true);
    // popoverTransactions が新フィールドとして正しく比較対象になっていれば、
    // 超過分の tx オブジェクトの参照差し替えを検出して false になる。
    expect(isSameWalletNode(previous, next)).toBe(false);
  });
});
