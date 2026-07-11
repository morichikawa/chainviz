// PeerObservationCache 単体テスト（Issue #288）。`pollPeersOnce` を経由した
// 結合的なヒステリシス挙動は consensus-peer-hysteresis.test.ts を参照
// （CLAUDE.md「テストは関心事ごとの分割を都度検討する」）。

import { describe, expect, it } from "vitest";
import type { NodePeers } from "./peers.js";
import { PeerObservationCache } from "./peer-observation-cache.js";

function nodePeers(overrides: Partial<NodePeers> = {}): NodePeers {
  return {
    stableId: "chainviz-ethereum/beacon1",
    peerId: "peer-1",
    networkId: "chainviz-ethereum-consensus",
    connectedPeerIds: ["peer-2"],
    ...overrides,
  };
}

describe("PeerObservationCache", () => {
  it("returns no fallback for a node that has never succeeded (falls back to legacy drop behavior)", () => {
    const cache = new PeerObservationCache(3);
    const result = cache.recordFailure("chainviz-ethereum/beacon1");
    expect(result.consecutiveFailures).toBe(1);
    expect(result.fallback).toBeUndefined();
  });

  it("returns lastGood as fallback while within grace ticks", () => {
    const cache = new PeerObservationCache(3);
    const observed = nodePeers();
    cache.recordSuccess("chainviz-ethereum/beacon1", observed);

    const r1 = cache.recordFailure("chainviz-ethereum/beacon1");
    expect(r1.consecutiveFailures).toBe(1);
    expect(r1.fallback).toEqual(observed);

    const r2 = cache.recordFailure("chainviz-ethereum/beacon1");
    expect(r2.consecutiveFailures).toBe(2);
    expect(r2.fallback).toEqual(observed);

    const r3 = cache.recordFailure("chainviz-ethereum/beacon1");
    expect(r3.consecutiveFailures).toBe(3);
    expect(r3.fallback).toEqual(observed);
  });

  it("stops returning fallback once consecutive failures exceed grace ticks (boundary)", () => {
    const cache = new PeerObservationCache(3);
    const observed = nodePeers();
    cache.recordSuccess("chainviz-ethereum/beacon1", observed);

    cache.recordFailure("chainviz-ethereum/beacon1");
    cache.recordFailure("chainviz-ethereum/beacon1");
    cache.recordFailure("chainviz-ethereum/beacon1");
    const r4 = cache.recordFailure("chainviz-ethereum/beacon1");
    expect(r4.consecutiveFailures).toBe(4);
    expect(r4.fallback).toBeUndefined();
  });

  it("keeps lastGood after grace is exceeded, so a later success still resets cleanly", () => {
    const cache = new PeerObservationCache(1);
    const observed = nodePeers();
    cache.recordSuccess("chainviz-ethereum/beacon1", observed);
    cache.recordFailure("chainviz-ethereum/beacon1"); // 1: within grace
    cache.recordFailure("chainviz-ethereum/beacon1"); // 2: exceeds grace

    const nextObserved = nodePeers({ connectedPeerIds: ["peer-3"] });
    cache.recordSuccess("chainviz-ethereum/beacon1", nextObserved);
    const r = cache.recordFailure("chainviz-ethereum/beacon1");
    expect(r.consecutiveFailures).toBe(1);
    expect(r.fallback).toEqual(nextObserved);
  });

  it("resets consecutive failures on success", () => {
    const cache = new PeerObservationCache(3);
    const observed = nodePeers();
    cache.recordSuccess("chainviz-ethereum/beacon1", observed);
    cache.recordFailure("chainviz-ethereum/beacon1");
    cache.recordFailure("chainviz-ethereum/beacon1");

    cache.recordSuccess("chainviz-ethereum/beacon1", observed);
    const r = cache.recordFailure("chainviz-ethereum/beacon1");
    expect(r.consecutiveFailures).toBe(1);
  });

  it("tracks per-node state independently", () => {
    const cache = new PeerObservationCache(3);
    cache.recordSuccess("chainviz-ethereum/beacon1", nodePeers());
    cache.recordFailure("chainviz-ethereum/beacon1");
    cache.recordFailure("chainviz-ethereum/beacon1");

    const r = cache.recordFailure(
      "chainviz-ethereum/beacon2",
    );
    expect(r.consecutiveFailures).toBe(1);
    expect(r.fallback).toBeUndefined();
  });

  it("discards entries not present in the current target set (prune)", () => {
    const cache = new PeerObservationCache(3);
    const observed = nodePeers();
    cache.recordSuccess("chainviz-ethereum/beacon1", observed);
    cache.recordFailure("chainviz-ethereum/beacon1");

    // beacon1 が対象集合から外れる（removeNode 相当）。
    cache.prune(new Set());

    // 破棄されているため、再登場後の失敗は fallback を持たない
    // 「未成功」として扱われる。
    const r = cache.recordFailure("chainviz-ethereum/beacon1");
    expect(r.consecutiveFailures).toBe(1);
    expect(r.fallback).toBeUndefined();
  });

  it("keeps entries still present in the current target set (prune)", () => {
    const cache = new PeerObservationCache(3);
    const observed = nodePeers();
    cache.recordSuccess("chainviz-ethereum/beacon1", observed);

    cache.prune(new Set(["chainviz-ethereum/beacon1"]));

    const r = cache.recordFailure("chainviz-ethereum/beacon1");
    expect(r.fallback).toEqual(observed);
  });
});
