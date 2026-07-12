// WorldStateStore の tx 保持窓（Issue #303）の、境界値・異常系・タイミング
// ズレに絞った補強テスト。基本的な保持方針（included/failed は block 連動、
// pending は件数上限）のハッピーパスは store-transaction-retention.test.ts が
// カバーする。ここでは以下の観点だけを扱う（関心事の分割。CLAUDE.md）:
//   - included/failed 入口ガードのタイミングズレ（tx が block より先着・
//     block 後着後の再配信・blockHash が block 以外のエンティティを指す場合）
//   - PENDING_TX_RETENTION 境界と pending -> included 遷移によるスロット解放
//   - 複数 block が同時に窓外へ押し出される場合の tx 退去の同期性
//   - 入口ガードで捨てた tx がウォレットの残高・nonce 観測を害しないこと
//     （残高はポーリングベースの applyWallets で独立に補完される）

import type { BlockEntity, DiffEvent, TransactionEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import type { WalletObservation } from "./diff.js";
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

/** store 内の tx エンティティの hash 一覧（hash でソート）。 */
function storedTxHashes(store: WorldStateStore): string[] {
  return store
    .getSnapshot()
    .entities.filter((e): e is TransactionEntity => e.kind === "transaction")
    .map((t) => t.hash)
    .sort();
}

/** 差分イベントのうち entityRemoved の id 集合。 */
function removedIds(diff: DiffEvent[]): Set<string> {
  return new Set(
    diff.filter((e): e is Extract<DiffEvent, { type: "entityRemoved" }> => e.type === "entityRemoved").map((e) => e.id),
  );
}

describe("WorldStateStore tx retention edge cases (Issue #303)", () => {
  describe("entry guard timing skew: tx arriving out of order relative to its block", () => {
    it("drops an included tx that arrives before its block, and the later block arrival alone does not resurrect it", () => {
      const store = new WorldStateStore();
      // 稀なケース: tx が対応 block より先着する（設計メモの前提では事実上
      // 起きないとされるが、起きたときの挙動を固定する）。
      const dropped = store.applyTransaction(
        tx({ hash: "0xearly", status: "included", blockHash: "0xb1" }),
      );
      expect(dropped).toEqual([]);
      expect(store.hasTransaction("0xearly")).toBe(false);

      // block が後から届いても、既に捨てた tx を遡って取り込みはしない
      // （入口ガードは applyTransaction の瞬間の block 存在だけを見る）。
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      expect(store.hasTransaction("0xearly")).toBe(false);
      expect(storedTxHashes(store)).toEqual([]);
    });

    it("admits the tx when it is redelivered after its block has arrived (recovery on retry)", () => {
      const store = new WorldStateStore();
      // 先着で一度弾かれる。
      expect(
        store.applyTransaction(tx({ hash: "0xearly", status: "included", blockHash: "0xb1" })),
      ).toEqual([]);

      // block 到着後に同じ tx が再配信されれば取り込まれる。
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      const diff = store.applyTransaction(
        tx({ hash: "0xearly", status: "included", blockHash: "0xb1" }),
      );
      expect(diff).toEqual([
        {
          type: "entityAdded",
          entity: tx({ hash: "0xearly", status: "included", blockHash: "0xb1" }),
        },
      ]);
      expect(store.hasTransaction("0xearly")).toBe(true);
    });

    it("drops an included tx whose blockHash points to an entity that exists but is not a block", () => {
      const store = new WorldStateStore();
      // 先に pending tx を入れておき、その hash を blockHash として参照する
      // included tx を流す。get はヒットするが kind は "transaction" なので
      // block 存在条件を満たさず捨てられる（kind チェックの境界）。
      store.applyTransaction(tx({ hash: "0xdecoy", status: "pending" }));
      const diff = store.applyTransaction(
        tx({ hash: "0xchild", status: "included", blockHash: "0xdecoy" }),
      );
      expect(diff).toEqual([]);
      expect(store.hasTransaction("0xchild")).toBe(false);
      // decoy 自身は無傷。
      expect(store.hasTransaction("0xdecoy")).toBe(true);
    });
  });

  describe("PENDING_TX_RETENTION boundary interacting with pending -> included transition", () => {
    it("frees a pending slot when a pending tx transitions to included, so a new pending fits without eviction", () => {
      const store = new WorldStateStore();
      for (let i = 0; i < 256; i++) {
        store.applyTransaction(tx({ hash: `0xp${i}` }));
      }
      // 最古 (0xp0) を included へ遷移させる（block を先に seed）。pending 件数は
      // 256 -> 255 に減る（included は pending cap の対象外）。
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      store.applyTransaction(
        tx({ hash: "0xp0", status: "included", blockHash: "0xb1" }),
      );

      // 空いたスロットに新しい pending が入る（255 + 1 = 256 なので間引き無し）。
      const diff = store.applyTransaction(tx({ hash: "0xp256" }));
      expect(diff).toEqual([{ type: "entityAdded", entity: tx({ hash: "0xp256" }) }]);
      expect(store.hasTransaction("0xp0")).toBe(true); // included として残存
      expect(store.hasTransaction("0xp1")).toBe(true); // 誤って間引かれていない
      expect(store.hasTransaction("0xp256")).toBe(true);
      expect(storedTxHashes(store)).toHaveLength(257); // 256 pending + 1 included
    });

    it("continues to slide the window: the next oldest pending is evicted on each subsequent overflow", () => {
      const store = new WorldStateStore();
      for (let i = 0; i < 256; i++) {
        store.applyTransaction(tx({ hash: `0xp${i}` }));
      }
      // 257 件目 -> 0xp0 退去。
      store.applyTransaction(tx({ hash: "0xp256" }));
      expect(store.hasTransaction("0xp0")).toBe(false);
      // さらに 258 件目 -> 次に古い 0xp1 が退去（窓のスライドが継続する）。
      const diff = store.applyTransaction(tx({ hash: "0xp257" }));
      expect(diff).toEqual([
        { type: "entityAdded", entity: tx({ hash: "0xp257" }) },
        { type: "entityRemoved", id: "0xp1" },
      ]);
      expect(store.hasTransaction("0xp1")).toBe(false);
      expect(store.hasTransaction("0xp2")).toBe(true);
      expect(storedTxHashes(store)).toHaveLength(256);
    });

    it("re-admits a cap-evicted pending tx when it is redelivered as pending (not permanently lost)", () => {
      const store = new WorldStateStore();
      for (let i = 0; i < 256; i++) {
        store.applyTransaction(tx({ hash: `0xp${i}` }));
      }
      store.applyTransaction(tx({ hash: "0xp256" })); // 0xp0 退去
      expect(store.hasTransaction("0xp0")).toBe(false);

      // 0xp0 が pending のまま再配信されると、末尾に入り直し、次に古い pending
      // （0xp1）が代わりに退去する。恒久的な取りこぼしにはならない。
      const diff = store.applyTransaction(tx({ hash: "0xp0" }));
      expect(diff).toEqual([
        { type: "entityAdded", entity: tx({ hash: "0xp0" }) },
        { type: "entityRemoved", id: "0xp1" },
      ]);
      expect(store.hasTransaction("0xp0")).toBe(true);
      expect(store.hasTransaction("0xp1")).toBe(false);
    });
  });

  describe("block eviction / tx eviction synchronization across multiple blocks", () => {
    it("removes every tx of every block pushed out by a single large block-number jump", () => {
      const store = new WorldStateStore();
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      store.applyBlock(block({ hash: "0xb2", number: 2 }));
      store.applyBlock(block({ hash: "0xb3", number: 3 }));
      // b1 に 2 件、b2 に 1 件、b3 に 2 件の included tx を紐付ける。
      store.applyTransaction(tx({ hash: "0xa1", status: "included", blockHash: "0xb1" }));
      store.applyTransaction(tx({ hash: "0xa2", status: "included", blockHash: "0xb1" }));
      store.applyTransaction(tx({ hash: "0xa3", status: "included", blockHash: "0xb2" }));
      store.applyTransaction(tx({ hash: "0xa4", status: "included", blockHash: "0xb3" }));
      store.applyTransaction(tx({ hash: "0xa5", status: "included", blockHash: "0xb3" }));
      expect(storedTxHashes(store)).toHaveLength(5);

      // 一気に番号 40 まで飛ばす。窓下限 = 40 - 32 + 1 = 9。b1/b2/b3 は全て
      // 窓外となり、それぞれに紐づく tx が同じ差分の中で全て消える。
      const diff = store.applyBlock(block({ hash: "0xbig", number: 40 }));
      expect(removedIds(diff)).toEqual(
        new Set(["0xb1", "0xb2", "0xb3", "0xa1", "0xa2", "0xa3", "0xa4", "0xa5"]),
      );
      expect(storedTxHashes(store)).toEqual([]);
      for (const h of ["0xa1", "0xa2", "0xa3", "0xa4", "0xa5"]) {
        expect(store.hasTransaction(h)).toBe(false);
      }
    });

    it("removes only the txs of the evicted block and keeps txs of blocks still in window", () => {
      const store = new WorldStateStore();
      store.applyBlock(block({ hash: "0xb1", number: 1 }));
      store.applyBlock(block({ hash: "0xb2", number: 2 }));
      store.applyTransaction(tx({ hash: "0xa1", status: "included", blockHash: "0xb1" }));
      store.applyTransaction(tx({ hash: "0xa2", status: "included", blockHash: "0xb2" }));

      // 番号 33 まで進めると窓下限 = 2。b1(番号1) だけ窓外、b2(番号2) は残る。
      for (let n = 3; n <= 33; n++) {
        store.applyBlock(block({ hash: `0xb${n}`, number: n }));
      }
      expect(store.hasTransaction("0xa1")).toBe(false); // b1 と一緒に消えた
      expect(store.hasTransaction("0xa2")).toBe(true); // b2 は窓内なので残る
      expect(storedTxHashes(store)).toEqual(["0xa2"]);
    });
  });

  describe("entry-guard drop does not harm wallet balance/nonce observation", () => {
    function walletObs(overrides: Partial<WalletObservation> = {}): WalletObservation {
      return {
        address: "0xsender",
        ownerWorkbenchId: "wb1",
        balance: "100",
        nonce: 1,
        ...overrides,
      };
    }

    it("keeps balance/nonce updates flowing via polling even when an included tx is dropped by the entry guard", () => {
      const store = new WorldStateStore();
      store.applyWallets([walletObs()]);

      // 追いつきで届いた過去 tx: 対応 block が store に無いので入口ガードで
      // 捨てられる。index.ts は hasTransaction が false なら
      // linkTransactionToWallets を呼ばない配線なので、それを模す。
      const applied = store.applyTransaction(
        tx({ hash: "0xstale", status: "included", blockHash: "0xabsent", from: "0xsender" }),
      );
      const linked = store.hasTransaction("0xstale")
        ? store.linkTransactionToWallets(tx({ hash: "0xstale", from: "0xsender" }))
        : [];
      expect(applied).toEqual([]);
      expect(linked).toEqual([]); // 捨てられた tx はウォレットに紐付かない

      // 次のポーリング周期の残高・nonce は tx 紐付けと無関係に反映される。
      store.applyWallets([walletObs({ balance: "90", nonce: 2 })]);
      const wallet = store
        .getSnapshot()
        .entities.find((e) => e.kind === "wallet" && e.address === "0xsender");
      expect(wallet).toMatchObject({ balance: "90", nonce: 2, recentTxHashes: [] });
    });

    it("links the tx to the wallet only when the entry guard admits it (block present)", () => {
      const store = new WorldStateStore();
      store.applyWallets([walletObs()]);
      store.applyBlock(block({ hash: "0xb1", number: 1 }));

      store.applyTransaction(
        tx({ hash: "0xok", status: "included", blockHash: "0xb1", from: "0xsender" }),
      );
      // 取り込まれたので index.ts は linkTransactionToWallets を呼ぶ。
      expect(store.hasTransaction("0xok")).toBe(true);
      store.linkTransactionToWallets(tx({ hash: "0xok", from: "0xsender" }));
      const wallet = store
        .getSnapshot()
        .entities.find((e) => e.kind === "wallet" && e.address === "0xsender");
      expect(wallet).toMatchObject({ recentTxHashes: ["0xok"] });
    });
  });
});
