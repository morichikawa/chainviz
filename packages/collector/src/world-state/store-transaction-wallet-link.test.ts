// WorldStateStore.linkTransactionToWallets のユニットテスト。
//
// `WalletEntity.recentTxHashes` はウォレットカードの tx チップ表示
// （ARCHITECTURE.md §6.6）に使われるが、実際の collector からは一度も
// 更新されず常に空のままという欠落が Issue #201 の E2E 実装（UI-C-02:
// 送金元ウォレットカードに tx チップが現れる）で発覚した。この修正
// （tx の from/to に一致する既存ウォレットへ hash を反映する）専用の
// テストファイルとして store.test.ts から分離する（関心事ごとの分割）。

import type { TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { WorldStateStore } from "./store.js";

function tx(overrides: Partial<TransactionEntity> = {}): TransactionEntity {
  return {
    kind: "transaction",
    hash: "0xtx1",
    from: "0xsender",
    to: "0xrecipient",
    status: "pending",
    ...overrides,
  };
}

/** applyWallets 経由で `WalletEntity` を1件作る(store.test.ts と同じ観測形式)。 */
function seedWallet(
  store: WorldStateStore,
  address: string,
  ownerWorkbenchId = "chainviz-ethereum/workbench",
): void {
  store.applyWallets([
    { address, ownerWorkbenchId, balance: "100", nonce: 0 },
  ]);
}

describe("WorldStateStore.linkTransactionToWallets", () => {
  it("prepends the tx hash to a wallet matching tx.from", () => {
    const store = new WorldStateStore();
    seedWallet(store, "0xsender");
    const diff = store.linkTransactionToWallets(tx());
    expect(diff).toEqual([
      { type: "entityUpdated", id: "0xsender", patch: { recentTxHashes: ["0xtx1"] } },
    ]);
  });

  it("updates a wallet matching tx.to as well as tx.from in a single call", () => {
    const store = new WorldStateStore();
    seedWallet(store, "0xsender");
    seedWallet(store, "0xrecipient");
    const diff = store.linkTransactionToWallets(tx());
    expect(diff).toHaveLength(2);
    const patchedIds = diff.map((event) =>
      event.type === "entityUpdated" ? event.id : undefined,
    );
    expect(patchedIds.sort()).toEqual(["0xrecipient", "0xsender"]);
  });

  it("matches addresses case-insensitively (checksummed WalletEntity.address vs lowercase tx.from/to)", () => {
    // WalletEntity.address は mnemonic 由来の EIP-55 チェックサム表記になり
    // うる一方、tx.from/to は RPC 由来の小文字表記になりうる
    // (wallet-derivation.ts / eth-rpc-client.ts 参照)。
    const store = new WorldStateStore();
    seedWallet(store, "0xAbCdEf0000000000000000000000000000000000");
    const diff = store.linkTransactionToWallets(
      tx({ from: "0xabcdef0000000000000000000000000000000000", to: null }),
    );
    expect(diff).toEqual([
      {
        type: "entityUpdated",
        id: "0xAbCdEf0000000000000000000000000000000000",
        patch: { recentTxHashes: ["0xtx1"] },
      },
    ]);
  });

  it("does nothing when neither from nor to matches a tracked wallet", () => {
    const store = new WorldStateStore();
    seedWallet(store, "0xsomeoneelse");
    expect(store.linkTransactionToWallets(tx())).toEqual([]);
  });

  it("handles contract-creation txs (to: null) without throwing", () => {
    const store = new WorldStateStore();
    seedWallet(store, "0xsender");
    const diff = store.linkTransactionToWallets(tx({ to: null }));
    expect(diff).toEqual([
      { type: "entityUpdated", id: "0xsender", patch: { recentTxHashes: ["0xtx1"] } },
    ]);
  });

  it("does not add the same tx hash twice (pending -> included re-applies the same tx)", () => {
    const store = new WorldStateStore();
    seedWallet(store, "0xsender");
    store.linkTransactionToWallets(tx());
    const diff = store.linkTransactionToWallets(
      tx({ status: "included", blockHash: "0xblock" }),
    );
    expect(diff).toEqual([]);
    const wallet = store
      .getSnapshot()
      .entities.find((e) => e.kind === "wallet" && e.address === "0xsender");
    expect(wallet).toMatchObject({ recentTxHashes: ["0xtx1"] });
  });

  it("prepends newer hashes to the front (most recent first)", () => {
    const store = new WorldStateStore();
    seedWallet(store, "0xsender");
    store.linkTransactionToWallets(tx({ hash: "0xa" }));
    store.linkTransactionToWallets(tx({ hash: "0xb" }));
    const wallet = store
      .getSnapshot()
      .entities.find((e) => e.kind === "wallet" && e.address === "0xsender");
    expect(wallet).toMatchObject({ recentTxHashes: ["0xb", "0xa"] });
  });

  it("caps recentTxHashes and drops the oldest entries beyond the limit", () => {
    const store = new WorldStateStore();
    seedWallet(store, "0xsender");
    // 上限(20)を超える数の tx を反映させ、古いものから切り捨てられることを
    // 確認する(store.ts の MAX_WALLET_RECENT_TX_HASHES)。
    for (let i = 0; i < 25; i++) {
      store.linkTransactionToWallets(tx({ hash: `0x${i}` }));
    }
    const wallet = store
      .getSnapshot()
      .entities.find((e) => e.kind === "wallet" && e.address === "0xsender") as {
      recentTxHashes: string[];
    };
    expect(wallet.recentTxHashes).toHaveLength(20);
    // 最新(0x24)が先頭、最も古い5件(0x0〜0x4)は切り捨てられている。
    expect(wallet.recentTxHashes[0]).toBe("0x24");
    expect(wallet.recentTxHashes).not.toContain("0x0");
    expect(wallet.recentTxHashes).not.toContain("0x4");
  });

  it("does not touch non-wallet entities", () => {
    const store = new WorldStateStore();
    store.applyTransaction(tx());
    seedWallet(store, "0xsender");
    const diff = store.linkTransactionToWallets(tx());
    expect(diff).toHaveLength(1);
    expect(diff[0]).toMatchObject({ id: "0xsender" });
  });
});
