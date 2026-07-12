// WorldStateStore.applyBlock のブロック番号ベースの保持窓（BLOCK_RETENTION）の
// ユニットテスト。
//
// Issue #298: リボン表示のために「直近Nブロックだけ持てば良い」ことが
// 判明したのを機に、store 側の block 保持に上限を設けた。窓の境界値・
// 挿入順ではなく番号順で evict すること・フォーク（同一番号の複数ハッシュ）
// の共存を主な関心事とし、store.test.ts の基本的な add/update/remove の
// ケースからは分離する（関心事ごとの分割）。

import type { BlockEntity } from "@chainviz/shared";
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

/** store 内の block エンティティ一覧（number でソート）。 */
function storedBlockNumbers(store: WorldStateStore): number[] {
  return store
    .getSnapshot()
    .entities.filter((e): e is BlockEntity => e.kind === "block")
    .map((b) => b.number)
    .sort((a, b) => a - b);
}

describe("WorldStateStore.applyBlock retention window (BLOCK_RETENTION = 32)", () => {
  it("keeps exactly 32 blocks with no eviction when 32 sequential blocks arrive", () => {
    const store = new WorldStateStore();
    for (let n = 1; n <= 32; n++) {
      const diff = store.applyBlock(
        block({ hash: `0xb${n}`, number: n, parentHash: `0xb${n - 1}` }),
      );
      expect(diff).toEqual([
        { type: "entityAdded", entity: block({ hash: `0xb${n}`, number: n, parentHash: `0xb${n - 1}` }) },
      ]);
    }
    expect(storedBlockNumbers(store)).toEqual(
      Array.from({ length: 32 }, (_, i) => i + 1),
    );
  });

  it("evicts the oldest block (number 1) when the 33rd sequential block arrives", () => {
    const store = new WorldStateStore();
    for (let n = 1; n <= 32; n++) {
      store.applyBlock(
        block({ hash: `0xb${n}`, number: n, parentHash: `0xb${n - 1}` }),
      );
    }
    const diff = store.applyBlock(
      block({ hash: "0xb33", number: 33, parentHash: "0xb32" }),
    );
    expect(diff).toEqual([
      { type: "entityAdded", entity: block({ hash: "0xb33", number: 33, parentHash: "0xb32" }) },
      { type: "entityRemoved", id: "0xb1" },
    ]);
    expect(storedBlockNumbers(store)).toEqual(
      Array.from({ length: 32 }, (_, i) => i + 2), // 2..33
    );
  });

  it("evicts multiple blocks at once when a large gap advances the window", () => {
    // 追いつき中の別ノードから届いたブロックではなく、単一チェーンが一気に
    // 進んだ場合（例: 再接続直後の一括 catch-up）でも窓は正しく前進する。
    const store = new WorldStateStore();
    store.applyBlock(block({ hash: "0xb1", number: 1 }));
    store.applyBlock(block({ hash: "0xb2", number: 2 }));
    const diff = store.applyBlock(block({ hash: "0xb40", number: 40 }));
    // 窓下限 = 40 - 32 + 1 = 9。1, 2 とも窓外なので両方削除される。
    expect(diff).toEqual([
      { type: "entityAdded", entity: block({ hash: "0xb40", number: 40 }) },
      { type: "entityRemoved", id: "0xb1" },
      { type: "entityRemoved", id: "0xb2" },
    ]);
    expect(storedBlockNumbers(store)).toEqual([40]);
  });

  it("rejects a block older than the window and returns an empty diff without evicting anything", () => {
    // addNode 直後の追いつき中ノードが過去ブロックの newHeads を大量に流す
    // ケースの再現: 先端が既に 100 まで進んだ後、はるか過去（number 1）の
    // ブロックが届いても取り込まない（正史の先端側が押し出されない）。
    const store = new WorldStateStore();
    store.applyBlock(block({ hash: "0xb100", number: 100 }));
    const diff = store.applyBlock(block({ hash: "0xstale", number: 1 }));
    expect(diff).toEqual([]);
    expect(storedBlockNumbers(store)).toEqual([100]);
    expect(store.getSnapshot().entities.some((e) => e.kind === "block" && e.hash === "0xstale")).toBe(false);
  });

  it("rejects a block exactly one below the window lower bound", () => {
    const store = new WorldStateStore();
    store.applyBlock(block({ hash: "0xb32", number: 32 }));
    // 窓下限 = 32 - 32 + 1 = 1。番号 0 は窓外。
    const diff = store.applyBlock(block({ hash: "0xb0", number: 0 }));
    expect(diff).toEqual([]);
    expect(storedBlockNumbers(store)).toEqual([32]);
  });

  it("accepts a block exactly at the window lower bound", () => {
    const store = new WorldStateStore();
    store.applyBlock(block({ hash: "0xb32", number: 32 }));
    // 窓下限 = 32 - 32 + 1 = 1。番号 1 は窓内（境界値）。
    const diff = store.applyBlock(block({ hash: "0xb1", number: 1 }));
    expect(diff).toEqual([
      { type: "entityAdded", entity: block({ hash: "0xb1", number: 1 }) },
    ]);
    expect(storedBlockNumbers(store)).toEqual([1, 32]);
  });

  it("keeps both hashes of a same-number fork inside the window, and evicts both together once the window advances past them", () => {
    const store = new WorldStateStore();
    const forkA = block({ hash: "0xforkA", number: 5, parentHash: "0xp" });
    const forkB = block({ hash: "0xforkB", number: 5, parentHash: "0xp" });
    store.applyBlock(forkA);
    const diffB = store.applyBlock(forkB);
    // 同一番号・別ハッシュはどちらも entityAdded として共存する（キーは hash）。
    expect(diffB).toEqual([{ type: "entityAdded", entity: forkB }]);
    expect(
      store
        .getSnapshot()
        .entities.filter((e) => e.kind === "block" && e.number === 5),
    ).toHaveLength(2);

    // 窓を 5 より先に進めると、フォークの両方が同時に evict される。
    const diff = store.applyBlock(block({ hash: "0xb37", number: 37 }));
    expect(diff).toEqual([
      { type: "entityAdded", entity: block({ hash: "0xb37", number: 37 }) },
      { type: "entityRemoved", id: "0xforkA" },
      { type: "entityRemoved", id: "0xforkB" },
    ]);
    expect(
      store.getSnapshot().entities.filter((e) => e.kind === "block"),
    ).toHaveLength(1);
  });

  it("does not update maxObservedBlockNumber (and therefore does not shrink the window) when a stale block is rejected", () => {
    const store = new WorldStateStore();
    store.applyBlock(block({ hash: "0xb50", number: 50 }));
    store.applyBlock(block({ hash: "0xstale", number: 1 })); // rejected
    // 拒否された観測によって窓の下限が動いていないことを、その後
    // 正当な過去ブロック（窓内のはず）が通ることで確認する。
    // 窓下限は 50 - 32 + 1 = 19 のまま。
    const diff = store.applyBlock(block({ hash: "0xb19", number: 19 }));
    expect(diff).toEqual([
      { type: "entityAdded", entity: block({ hash: "0xb19", number: 19 }) },
    ]);
  });

  it("still applies entityUpdated (e.g. late receivedAt merge) for a block that remains inside the window", () => {
    const store = new WorldStateStore();
    store.applyBlock(
      block({ hash: "0xb10", number: 10, receivedAt: { a: 1000 } }),
    );
    store.applyBlock(block({ hash: "0xb20", number: 20 })); // window advances but 10 stays in
    const diff = store.applyBlock(
      block({ hash: "0xb10", number: 10, receivedAt: { a: 1000, b: 1200 } }),
    );
    expect(diff).toEqual([
      {
        type: "entityUpdated",
        id: "0xb10",
        patch: { receivedAt: { a: 1000, b: 1200 } },
      },
    ]);
  });

  it("returns an empty diff when the identical block is re-applied (no spurious update or eviction)", () => {
    // 同一ブロックの再受信（同じ hash・同じ内容）は差分ゼロ。窓も動かさない。
    const store = new WorldStateStore();
    const b = block({ hash: "0xb10", number: 10, receivedAt: { a: 1000 } });
    store.applyBlock(b);
    const diff = store.applyBlock(
      block({ hash: "0xb10", number: 10, receivedAt: { a: 1000 } }),
    );
    expect(diff).toEqual([]);
    expect(storedBlockNumbers(store)).toEqual([10]);
  });

  it("keeps both hashes of a fork at the current tip (same number as the observed max)", () => {
    // フォークは窓の内側だけでなく先端（観測済み最大番号）でも共存できる。
    const store = new WorldStateStore();
    store.applyBlock(block({ hash: "0xb1", number: 1 }));
    const tipA = block({ hash: "0xtipA", number: 2, parentHash: "0xb1" });
    const tipB = block({ hash: "0xtipB", number: 2, parentHash: "0xb1" });
    store.applyBlock(tipA);
    const diffB = store.applyBlock(tipB);
    // 先端フォークは entityRemoved を伴わずに両方 add される（番号は進まない）。
    expect(diffB).toEqual([{ type: "entityAdded", entity: tipB }]);
    expect(
      store
        .getSnapshot()
        .entities.filter((e) => e.kind === "block" && e.number === 2),
    ).toHaveLength(2);
  });

  it("accepts the genesis block (number 0) as the first observation", () => {
    // 最初の観測が番号0でも、窓下限 = 0 - 32 + 1 = -31 なので取り込まれる。
    const store = new WorldStateStore();
    const diff = store.applyBlock(block({ hash: "0xgenesis", number: 0 }));
    expect(diff).toEqual([
      { type: "entityAdded", entity: block({ hash: "0xgenesis", number: 0 }) },
    ]);
    expect(storedBlockNumbers(store)).toEqual([0]);
  });

  it("does not disturb infra entities or edges while evicting blocks", () => {
    const store = new WorldStateStore();
    for (let n = 1; n <= 33; n++) {
      store.applyBlock(block({ hash: `0xb${n}`, number: n }));
    }
    // node/workbench や edge は block の保持窓の影響を受けない（別関心事）。
    // ここでは block だけが残り 32 件であることの確認に留める。
    expect(storedBlockNumbers(store)).toHaveLength(32);
  });
});
