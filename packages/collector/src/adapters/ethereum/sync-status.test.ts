import type { NodeInternals } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  extractFinishCheckpoint,
  NodeSyncStatusCache,
  SYNCED_TOLERANCE_BLOCKS,
} from "./sync-status.js";

describe("extractFinishCheckpoint", () => {
  it("returns the Finish stage checkpoint when present", () => {
    const internals: NodeInternals = {
      syncStages: [
        { stage: "Headers", checkpoint: 100 },
        { stage: "Finish", checkpoint: 95 },
      ],
    };
    expect(extractFinishCheckpoint(internals)).toBe(95);
  });

  it("returns undefined when syncStages has no Finish entry", () => {
    const internals: NodeInternals = {
      syncStages: [{ stage: "Headers", checkpoint: 100 }],
    };
    expect(extractFinishCheckpoint(internals)).toBeUndefined();
  });

  it("returns undefined when syncStages is an empty array", () => {
    expect(extractFinishCheckpoint({ syncStages: [] })).toBeUndefined();
  });

  it("returns undefined when syncStages is omitted entirely", () => {
    expect(extractFinishCheckpoint({ mempool: { pending: 0, queued: 0 } })).toBeUndefined();
  });

  it("returns 0 (not undefined) when the Finish checkpoint is genesis / zero", () => {
    // checkpoint 0（addNode 直後、genesis から参加してまだ 1 ブロックも
    // 処理していない状態）は「観測できていない（undefined）」とは異なる。
    // 0 を falsy として undefined に丸めてしまわないことを保証する。
    const internals: NodeInternals = {
      syncStages: [{ stage: "Finish", checkpoint: 0 }],
    };
    expect(extractFinishCheckpoint(internals)).toBe(0);
  });

  it("returns the first Finish entry when multiple are present (型上ありうる重複)", () => {
    // 通常 reth のメトリクスに Finish は 1 つだが、型（配列）上は複数
    // ありうる。find が先頭を返す挙動を固定する。
    const internals: NodeInternals = {
      syncStages: [
        { stage: "Finish", checkpoint: 500 },
        { stage: "Finish", checkpoint: 999 },
      ],
    };
    expect(extractFinishCheckpoint(internals)).toBe(500);
  });
});

describe("NodeSyncStatusCache", () => {
  it("returns undefined for a node that has never been observed", () => {
    const cache = new NodeSyncStatusCache();
    expect(cache.resolve("chainviz-ethereum/reth1")).toBeUndefined();
  });

  it("treats a single observed node as synced (no peer to compare against)", () => {
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 42 }],
    });
    expect(cache.resolve("chainviz-ethereum/reth1")).toEqual({
      syncStatus: "synced",
      blockHeight: 42,
    });
  });

  it("marks a node far behind the most-advanced peer as syncing", () => {
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 3000 }],
    });
    cache.update("chainviz-ethereum/reth3", {
      syncStages: [{ stage: "Finish", checkpoint: 100 }],
    });

    expect(cache.resolve("chainviz-ethereum/reth1")).toEqual({
      syncStatus: "synced",
      blockHeight: 3000,
    });
    expect(cache.resolve("chainviz-ethereum/reth3")).toEqual({
      syncStatus: "syncing",
      blockHeight: 100,
    });
  });

  it("treats a checkpoint exactly SYNCED_TOLERANCE_BLOCKS behind the max as synced (boundary)", () => {
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 1000 }],
    });
    cache.update("chainviz-ethereum/reth2", {
      syncStages: [
        { stage: "Finish", checkpoint: 1000 - SYNCED_TOLERANCE_BLOCKS },
      ],
    });
    expect(cache.resolve("chainviz-ethereum/reth2")?.syncStatus).toBe("synced");
  });

  it("treats a checkpoint one block beyond the tolerance as syncing (boundary)", () => {
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 1000 }],
    });
    cache.update("chainviz-ethereum/reth2", {
      syncStages: [
        { stage: "Finish", checkpoint: 1000 - SYNCED_TOLERANCE_BLOCKS - 1 },
      ],
    });
    expect(cache.resolve("chainviz-ethereum/reth2")?.syncStatus).toBe("syncing");
  });

  it("keeps the previous height when a later observation lacks a Finish checkpoint", () => {
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 200 }],
    });
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Headers", checkpoint: 250 }],
    });
    expect(cache.resolve("chainviz-ethereum/reth1")?.blockHeight).toBe(200);
  });

  it("resolves a node observed at checkpoint 0 instead of treating it as never observed", () => {
    // blockHeight 0 は「D層観測がまだ無い（undefined）」とは区別される。
    // 0 を falsy として undefined 扱いにしてしまわないことを保証する。
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 0 }],
    });
    expect(cache.resolve("chainviz-ethereum/reth1")).toEqual({
      syncStatus: "synced",
      blockHeight: 0,
    });
  });

  it("marks a node at height 0 as syncing when a peer is far ahead", () => {
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 3000 }],
    });
    cache.update("chainviz-ethereum/reth3", {
      syncStages: [{ stage: "Finish", checkpoint: 0 }],
    });
    expect(cache.resolve("chainviz-ethereum/reth3")).toEqual({
      syncStatus: "syncing",
      blockHeight: 0,
    });
  });

  it("treats two peers at identical heights (0 blocks apart) as both synced", () => {
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 1234 }],
    });
    cache.update("chainviz-ethereum/reth2", {
      syncStages: [{ stage: "Finish", checkpoint: 1234 }],
    });
    expect(cache.resolve("chainviz-ethereum/reth1")?.syncStatus).toBe("synced");
    expect(cache.resolve("chainviz-ethereum/reth2")?.syncStatus).toBe("synced");
  });

  it("always reports the most-advanced node itself as synced (behind = 0)", () => {
    // 自分が最大値である場合、maxHeight - height = 0 で synced。
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 9000 }],
    });
    cache.update("chainviz-ethereum/reth3", {
      syncStages: [{ stage: "Finish", checkpoint: 10 }],
    });
    expect(cache.resolve("chainviz-ethereum/reth1")?.syncStatus).toBe("synced");
  });

  it("reflects a newer max from a non-simultaneous update against a stale peer value", () => {
    // 全ノードが同時に更新されるわけではない。ある周期で reth1 だけが先へ
    // 進み、reth3 は前周期の古い値のまま resolve される。判定は「今キャッシュに
    // ある最大値」に対して行われるため、reth3 が閾値超に転じることを確認する。
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 1000 }],
    });
    cache.update("chainviz-ethereum/reth3", {
      syncStages: [{ stage: "Finish", checkpoint: 998 }],
    });
    // この時点では 2 ブロック差で synced。
    expect(cache.resolve("chainviz-ethereum/reth3")?.syncStatus).toBe("synced");

    // reth1 だけが次周期で大きく進む（reth3 は未更新の古い値のまま）。
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 1100 }],
    });
    expect(cache.resolve("chainviz-ethereum/reth3")).toEqual({
      syncStatus: "syncing",
      blockHeight: 998,
    });
  });

  it("updates a node's height in place when it advances (overwrites the previous value)", () => {
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 100 }],
    });
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 250 }],
    });
    expect(cache.resolve("chainviz-ethereum/reth1")?.blockHeight).toBe(250);
  });

  it("is a no-op when forgetNode is called for an unknown node", () => {
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 42 }],
    });
    expect(() => cache.forgetNode("chainviz-ethereum/never-seen")).not.toThrow();
    // 既存ノードには影響しない。
    expect(cache.resolve("chainviz-ethereum/reth1")?.blockHeight).toBe(42);
  });

  it("returns undefined for a not-yet-observed node while a peer is already resolvable", () => {
    // 新規追加直後でまだ D層観測が届いていないノードは undefined
    // （呼び出し側は既定のプレースホルダを使う）。既に観測済みのピアは
    // その影響を受けず解決できる。
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 500 }],
    });
    expect(cache.resolve("chainviz-ethereum/reth3")).toBeUndefined();
    expect(cache.resolve("chainviz-ethereum/reth1")?.blockHeight).toBe(500);
  });

  it("excludes a forgotten node from the max-height comparison", () => {
    const cache = new NodeSyncStatusCache();
    cache.update("chainviz-ethereum/reth1", {
      syncStages: [{ stage: "Finish", checkpoint: 5000 }],
    });
    cache.update("chainviz-ethereum/reth3", {
      syncStages: [{ stage: "Finish", checkpoint: 100 }],
    });
    expect(cache.resolve("chainviz-ethereum/reth3")?.syncStatus).toBe("syncing");

    cache.forgetNode("chainviz-ethereum/reth1");
    // reth1（比較基準だった最先端ノード）が消えたため、reth3 は
    // （残っている中では）自分しかいない状態になり synced とみなされる。
    expect(cache.resolve("chainviz-ethereum/reth3")?.syncStatus).toBe("synced");
    // reth1 自体はキャッシュから消え、undefined に戻る。
    expect(cache.resolve("chainviz-ethereum/reth1")).toBeUndefined();
  });
});
