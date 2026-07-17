import { describe, expect, it } from "vitest";
import type { BeaconSyncingSnapshot } from "./beacon-api.js";
import {
  BeaconSyncStatusCache,
  resolveBeaconSyncStatus,
} from "./beacon-sync-status.js";

function snapshot(
  overrides: Partial<BeaconSyncingSnapshot> = {},
): BeaconSyncingSnapshot {
  return {
    isSyncing: false,
    isOptimistic: false,
    elOffline: false,
    headSlot: 16587,
    ...overrides,
  };
}

describe("resolveBeaconSyncStatus", () => {
  it("resolves to synced when all three self-reported flags are false", () => {
    expect(resolveBeaconSyncStatus(snapshot())).toEqual({
      syncStatus: "synced",
      blockHeight: 16587,
    });
  });

  it("resolves to syncing when is_syncing is true", () => {
    expect(
      resolveBeaconSyncStatus(snapshot({ isSyncing: true })).syncStatus,
    ).toBe("syncing");
  });

  it("resolves to syncing when el_offline is true even though is_syncing is false", () => {
    // el_offline: 接続先 EL が落ちていて頭を進められない状態。
    // is_syncing 自体は false でも「健全に追従できている」とは言えない。
    expect(
      resolveBeaconSyncStatus(snapshot({ elOffline: true })).syncStatus,
    ).toBe("syncing");
  });

  it("resolves to syncing when is_optimistic is true even though is_syncing is false", () => {
    // is_optimistic: EL 未検証のヘッドを楽観的に持っている状態。
    expect(
      resolveBeaconSyncStatus(snapshot({ isOptimistic: true })).syncStatus,
    ).toBe("syncing");
  });

  it("resolves to syncing when all three flags are true", () => {
    expect(
      resolveBeaconSyncStatus(
        snapshot({ isSyncing: true, isOptimistic: true, elOffline: true }),
      ).syncStatus,
    ).toBe("syncing");
  });

  it("carries head_slot through as blockHeight verbatim (not the EL block number)", () => {
    expect(
      resolveBeaconSyncStatus(snapshot({ headSlot: 999 })).blockHeight,
    ).toBe(999);
  });

  it("resolves a genesis head_slot of 0 as a real value, not a missing observation", () => {
    expect(resolveBeaconSyncStatus(snapshot({ headSlot: 0 }))).toEqual({
      syncStatus: "synced",
      blockHeight: 0,
    });
  });

  // 3 フラグ（is_syncing / is_optimistic / el_offline）の全 8 組み合わせを
  // 網羅する真理値表。「すべて false のときだけ synced、1 つでも true なら
  // syncing」という OR 判定を、5 件の個別 it では抜けていた FTT / TFT / TTF を
  // 含めて明示的に固定する（決定事項 3）。
  it.each([
    [false, false, false, "synced"],
    [true, false, false, "syncing"],
    [false, true, false, "syncing"],
    [false, false, true, "syncing"],
    [true, true, false, "syncing"],
    [true, false, true, "syncing"],
    [false, true, true, "syncing"],
    [true, true, true, "syncing"],
  ] as const)(
    "resolves is_syncing=%s is_optimistic=%s el_offline=%s to %s",
    (isSyncing, isOptimistic, elOffline, expected) => {
      expect(
        resolveBeaconSyncStatus(
          snapshot({ isSyncing, isOptimistic, elOffline }),
        ).syncStatus,
      ).toBe(expected);
    },
  );
});

describe("BeaconSyncStatusCache", () => {
  it("returns undefined for a node that has never been observed", () => {
    const cache = new BeaconSyncStatusCache();
    expect(cache.resolve("chainviz-ethereum/beacon1")).toBeUndefined();
  });

  it("returns the most recently set value for a node", () => {
    const cache = new BeaconSyncStatusCache();
    cache.set("chainviz-ethereum/beacon1", {
      syncStatus: "syncing",
      blockHeight: 10,
    });
    cache.set("chainviz-ethereum/beacon1", {
      syncStatus: "synced",
      blockHeight: 42,
    });
    expect(cache.resolve("chainviz-ethereum/beacon1")).toEqual({
      syncStatus: "synced",
      blockHeight: 42,
    });
  });

  it("does not have a max-height comparison across nodes (unlike NodeSyncStatusCache)", () => {
    // beacon はノード自身の自己申告で判定済みのため、他ノードとの比較は
    // 一切行わない。1台だけ大きく遅れていても互いに影響しない。
    const cache = new BeaconSyncStatusCache();
    cache.set("chainviz-ethereum/beacon1", {
      syncStatus: "synced",
      blockHeight: 9000,
    });
    cache.set("chainviz-ethereum/beacon2", {
      syncStatus: "synced",
      blockHeight: 10,
    });
    expect(cache.resolve("chainviz-ethereum/beacon1")?.syncStatus).toBe(
      "synced",
    );
    expect(cache.resolve("chainviz-ethereum/beacon2")?.syncStatus).toBe(
      "synced",
    );
  });

  it("removes a node's value on forgetNode without affecting other nodes", () => {
    const cache = new BeaconSyncStatusCache();
    cache.set("chainviz-ethereum/beacon1", {
      syncStatus: "synced",
      blockHeight: 100,
    });
    cache.set("chainviz-ethereum/beacon2", {
      syncStatus: "synced",
      blockHeight: 200,
    });
    cache.forgetNode("chainviz-ethereum/beacon1");
    expect(cache.resolve("chainviz-ethereum/beacon1")).toBeUndefined();
    expect(cache.resolve("chainviz-ethereum/beacon2")?.blockHeight).toBe(200);
  });

  it("is a no-op when forgetNode is called for an unknown node", () => {
    const cache = new BeaconSyncStatusCache();
    cache.set("chainviz-ethereum/beacon1", {
      syncStatus: "synced",
      blockHeight: 5,
    });
    expect(() =>
      cache.forgetNode("chainviz-ethereum/never-seen"),
    ).not.toThrow();
    expect(cache.resolve("chainviz-ethereum/beacon1")?.blockHeight).toBe(5);
  });

  it("re-observes a node after forgetNode without leaking the stale value (removeNode → addNode with the same stableId)", () => {
    // 同じ stableId のコンテナが一度消えて（removeNode → forgetNode）から
    // 再び現れた（addNode）場合、前回の値が残らず、次の観測で改めて埋まる
    // ことを固定する。set は前回値の有無に関わらず上書きするため素直に
    // 動くが、forget → resolve undefined → set の一連の遷移を明示しておく。
    const cache = new BeaconSyncStatusCache();
    cache.set("chainviz-ethereum/beacon1", {
      syncStatus: "syncing",
      blockHeight: 100,
    });
    cache.forgetNode("chainviz-ethereum/beacon1");
    expect(cache.resolve("chainviz-ethereum/beacon1")).toBeUndefined();
    cache.set("chainviz-ethereum/beacon1", {
      syncStatus: "synced",
      blockHeight: 250,
    });
    expect(cache.resolve("chainviz-ethereum/beacon1")).toEqual({
      syncStatus: "synced",
      blockHeight: 250,
    });
  });

  it("reset (Issue #357) forgets every node's resolved sync status", () => {
    const cache = new BeaconSyncStatusCache();
    cache.set("chainviz-ethereum/beacon1", {
      syncStatus: "synced",
      blockHeight: 100,
    });
    cache.set("chainviz-ethereum/beacon2", {
      syncStatus: "syncing",
      blockHeight: 50,
    });

    cache.reset();

    expect(cache.resolve("chainviz-ethereum/beacon1")).toBeUndefined();
    expect(cache.resolve("chainviz-ethereum/beacon2")).toBeUndefined();
  });
});
