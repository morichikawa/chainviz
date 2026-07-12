// WorldStateStore の tx（TransactionEntity）保持窓（Issue #303）のユニット
// テスト。included/failed tx は対応 block の store 内存在に連動し、pending
// tx は block eviction の対象外・件数上限（PENDING_TX_RETENTION）で有界化
// する、という 2 系統の保持方針を検証する。store.test.ts の基本的な
// add/update/remove のケースからは分離する（関心事ごとの分割。
// docs/worklog/issue-303.md 参照）。

import type { BlockEntity, TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import { WorldStateStore } from "./store.js";

function block(overrides: Partial<BlockEntity> = {}): BlockEntity {
  return {
    kind: "block",
    hash: "0xblock1",
    number: 1,
    parentHash: "0xparent",
    timestamp: 100,
    receivedAt: {},
    ...overrides,
  };
}

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

/** store 内の tx エンティティ一覧（hash でソート）。 */
function storedTxHashes(store: WorldStateStore): string[] {
  return store
    .getSnapshot()
    .entities.filter((e): e is TransactionEntity => e.kind === "transaction")
    .map((t) => t.hash)
    .sort();
}

describe("WorldStateStore tx retention (Issue #303)", () => {
  describe("included/failed tx retention follows the corresponding block's presence", () => {
    it("evicts an included tx together with the block eviction that pushes it out of the retention window", () => {
      const store = new WorldStateStore();
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      store.applyTransaction(
        tx({ hash: "0xincluded", status: "included", blockHash: "0xb1" }),
      );
      expect(storedTxHashes(store)).toEqual(["0xincluded"]);

      // block 番号窓 (BLOCK_RETENTION = 32) を b1 より先へ進める。
      for (let n = 2; n <= 33; n++) {
        store.applyBlock(block({ hash: `0xb${n}`, number: n }));
      }
      // 窓下限 = 33 - 32 + 1 = 2 なので b1 は退去し、included tx も同時に消える。
      expect(
        store.getSnapshot().entities.some((e) => e.kind === "block" && e.hash === "0xb1"),
      ).toBe(false);
      expect(storedTxHashes(store)).toEqual([]);
      expect(store.hasTransaction("0xincluded")).toBe(false);
    });

    it("removes the tx entityRemoved event in the same diff array as the block's eviction", () => {
      const store = new WorldStateStore();
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      store.applyTransaction(
        tx({ hash: "0xincluded", status: "included", blockHash: "0xb1" }),
      );
      for (let n = 2; n <= 32; n++) {
        store.applyBlock(block({ hash: `0xb${n}`, number: n }));
      }
      const diff = store.applyBlock(block({ hash: "0xb33", number: 33 }));
      expect(diff).toEqual([
        { type: "entityAdded", entity: block({ hash: "0xb33", number: 33 }) },
        { type: "entityRemoved", id: "0xb1" },
        { type: "entityRemoved", id: "0xincluded" },
      ]);
    });

    it("evicts a failed tx together with its block just like an included tx", () => {
      const store = new WorldStateStore();
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      store.applyTransaction(
        tx({ hash: "0xfailed", status: "failed", blockHash: "0xb1" }),
      );
      for (let n = 2; n <= 33; n++) {
        store.applyBlock(block({ hash: `0xb${n}`, number: n }));
      }
      expect(store.hasTransaction("0xfailed")).toBe(false);
    });

    it("keeps an included tx whose block remains inside the retention window", () => {
      const store = new WorldStateStore();
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      store.applyTransaction(
        tx({ hash: "0xincluded", status: "included", blockHash: "0xb1" }),
      );
      // 窓幅 32 未満しか進めていないので b1 はまだ窓内。
      for (let n = 2; n <= 20; n++) {
        store.applyBlock(block({ hash: `0xb${n}`, number: n }));
      }
      expect(store.hasTransaction("0xincluded")).toBe(true);
      expect(storedTxHashes(store)).toEqual(["0xincluded"]);
    });
  });

  describe("catch-up flood: entry guard rejects included/failed tx whose block is not (yet) in store", () => {
    it("drops an included tx referencing a block that has never been observed", () => {
      const store = new WorldStateStore();
      const diff = store.applyTransaction(
        tx({ hash: "0xorphan", status: "included", blockHash: "0xneverseen" }),
      );
      expect(diff).toEqual([]);
      expect(store.hasTransaction("0xorphan")).toBe(false);
      expect(storedTxHashes(store)).toEqual([]);
    });

    it("drops a past included tx whose block was already evicted by the retention window (addNode catch-up flood)", () => {
      const store = new WorldStateStore();
      // チェーンの先端が既に 100 まで進んでいる状態を再現する。
      store.applyBlock(block({ hash: "0xtip", number: 100 }));
      // 追いつき中の別ノードが番号 1 の過去ブロックの newHeads を後から流す
      // ケース: block 側は窓より古いので取り込まれず store に無い。
      store.applyBlock(block({ hash: "0xstaleblock", number: 1 }));
      expect(
        store.getSnapshot().entities.some((e) => e.kind === "block" && e.hash === "0xstaleblock"),
      ).toBe(false);

      // 同じ追いつきフラッドが、その過去ブロックに含まれる included tx も
      // 流してくる。block が無いので tx も取り込まれない。
      const diff = store.applyTransaction(
        tx({ hash: "0xstaletx", status: "included", blockHash: "0xstaleblock" }),
      );
      expect(diff).toEqual([]);
      expect(store.hasTransaction("0xstaletx")).toBe(false);
    });

    it("does not resurrect a tx once its block has been evicted, even if the same tx is redelivered", () => {
      const store = new WorldStateStore();
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      store.applyTransaction(
        tx({ hash: "0xincluded", status: "included", blockHash: "0xb1" }),
      );
      for (let n = 2; n <= 33; n++) {
        store.applyBlock(block({ hash: `0xb${n}`, number: n }));
      }
      expect(store.hasTransaction("0xincluded")).toBe(false);

      // 退去後に同じ tx がもう一度届いても（重複配信等）、block は既に無い
      // ため再取り込みされない。
      const diff = store.applyTransaction(
        tx({ hash: "0xincluded", status: "included", blockHash: "0xb1" }),
      );
      expect(diff).toEqual([]);
      expect(store.hasTransaction("0xincluded")).toBe(false);
    });
  });

  describe("pending tx is never removed by block eviction", () => {
    it("keeps a pending tx across many block evictions", () => {
      const store = new WorldStateStore();
      store.applyTransaction(tx({ hash: "0xpending", status: "pending" }));
      for (let n = 1; n <= 100; n++) {
        store.applyBlock(block({ hash: `0xb${n}`, number: n }));
      }
      expect(store.hasTransaction("0xpending")).toBe(true);
      expect(storedTxHashes(store)).toEqual(["0xpending"]);
    });

    it("evicting a block whose hash happens to collide with no pending tx's blockHash leaves pending tx untouched", () => {
      // pending tx は blockHash を持たないため、evictBlocksBelow の tx 走査で
      // `entity.blockHash` は undefined。Set.has(undefined) は常に false に
      // なるので誤って巻き込まれないことを明示的に確認する。
      const store = new WorldStateStore();
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      store.applyTransaction(tx({ hash: "0xpending", status: "pending" }));
      const diff = store.applyBlock(block({ hash: "0xb40", number: 40 }));
      expect(diff.some((e) => e.type === "entityRemoved" && e.id === "0xpending")).toBe(
        false,
      );
      expect(store.hasTransaction("0xpending")).toBe(true);
    });
  });

  describe("pending tx count cap (PENDING_TX_RETENTION = 256)", () => {
    it("keeps exactly 256 pending txs with no eviction when 256 arrive", () => {
      const store = new WorldStateStore();
      for (let i = 0; i < 256; i++) {
        const diff = store.applyTransaction(tx({ hash: `0xp${i}` }));
        expect(diff).toEqual([{ type: "entityAdded", entity: tx({ hash: `0xp${i}` }) }]);
      }
      expect(storedTxHashes(store)).toHaveLength(256);
    });

    it("evicts the oldest pending tx (insertion order) when the 257th pending tx arrives", () => {
      const store = new WorldStateStore();
      for (let i = 0; i < 256; i++) {
        store.applyTransaction(tx({ hash: `0xp${i}` }));
      }
      const diff = store.applyTransaction(tx({ hash: "0xp256" }));
      expect(diff).toEqual([
        { type: "entityAdded", entity: tx({ hash: "0xp256" }) },
        { type: "entityRemoved", id: "0xp0" },
      ]);
      expect(store.hasTransaction("0xp0")).toBe(false);
      expect(store.hasTransaction("0xp256")).toBe(true);
      expect(storedTxHashes(store)).toHaveLength(256);
    });

    it("does not evict pending txs based on wall-clock arrival order once an unrelated update occurs (only count matters)", () => {
      // 挿入順は Map のキー挿入順であり、既存キーへの再 set（entityUpdated）は
      // 順序を変えない。pending のまま内容だけ更新しても順序・cap 判定は
      // 変わらないことを確認する。
      const store = new WorldStateStore();
      for (let i = 0; i < 256; i++) {
        store.applyTransaction(tx({ hash: `0xp${i}` }));
      }
      // 先頭 (0xp0) の内容を pending のまま更新（順序は変わらないはず）。
      store.applyTransaction(tx({ hash: "0xp0", from: "0xnewsender" }));
      const diff = store.applyTransaction(tx({ hash: "0xp256" }));
      expect(diff).toEqual([
        { type: "entityAdded", entity: tx({ hash: "0xp256" }) },
        { type: "entityRemoved", id: "0xp0" },
      ]);
    });

    it("does not count included/failed txs toward the pending cap", () => {
      const store = new WorldStateStore();
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      // included tx は pending cap の対象外。
      for (let i = 0; i < 300; i++) {
        store.applyTransaction(
          tx({ hash: `0xincluded${i}`, status: "included", blockHash: "0xb1" }),
        );
      }
      expect(storedTxHashes(store)).toHaveLength(300);
      // pending は依然として 256 件まで許容される。
      for (let i = 0; i < 256; i++) {
        store.applyTransaction(tx({ hash: `0xp${i}` }));
      }
      const diff = store.applyTransaction(tx({ hash: "0xp256" }));
      expect(diff.some((e) => e.type === "entityRemoved" && e.id === "0xp0")).toBe(true);
    });
  });

  describe("pending -> included transition", () => {
    it("admits the transition once the block arrives, and the tx moves from pending-cap accounting to block-linked retention", () => {
      const store = new WorldStateStore();
      store.applyTransaction(tx({ hash: "0xtx1", status: "pending" }));
      expect(store.hasTransaction("0xtx1")).toBe(true);

      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      const diff = store.applyTransaction(
        tx({ hash: "0xtx1", status: "included", blockHash: "0xb1" }),
      );
      expect(diff).toEqual([
        {
          type: "entityUpdated",
          id: "0xtx1",
          patch: { status: "included", blockHash: "0xb1" },
        },
      ]);

      // included に遷移した後は block 連動側の管理下に入るため、block が
      // 窓落ちすれば tx も一緒に消える。
      for (let n = 2; n <= 33; n++) {
        store.applyBlock(block({ hash: `0xb${n}`, number: n }));
      }
      expect(store.hasTransaction("0xtx1")).toBe(false);
    });

    it("re-admits a tx that was evicted by the pending cap once it is later included and its block is present", () => {
      const store = new WorldStateStore();
      // pending cap を超過させ、0xp0 を間引く。
      for (let i = 0; i < 256; i++) {
        store.applyTransaction(tx({ hash: `0xp${i}` }));
      }
      store.applyTransaction(tx({ hash: "0xp256" }));
      expect(store.hasTransaction("0xp0")).toBe(false);

      // その後 0xp0 が included として（block 付きで）再度届けば取り込まれる
      // （恒久的な取りこぼしにはならない。docs/worklog/issue-303.md 参照）。
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      const diff = store.applyTransaction(
        tx({ hash: "0xp0", status: "included", blockHash: "0xb1" }),
      );
      expect(diff).toEqual([
        {
          type: "entityAdded",
          entity: tx({ hash: "0xp0", status: "included", blockHash: "0xb1" }),
        },
      ]);
      expect(store.hasTransaction("0xp0")).toBe(true);
    });
  });

  describe("hasTransaction", () => {
    it("returns false for a hash that was never observed", () => {
      const store = new WorldStateStore();
      expect(store.hasTransaction("0xneverseen")).toBe(false);
    });

    it("returns true right after a pending tx is admitted", () => {
      const store = new WorldStateStore();
      store.applyTransaction(tx({ hash: "0xtx1" }));
      expect(store.hasTransaction("0xtx1")).toBe(true);
    });

    it("returns false for an id that belongs to a non-transaction entity (e.g. a block hash)", () => {
      const store = new WorldStateStore();
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      expect(store.hasTransaction("0xb1")).toBe(false);
    });
  });
});
