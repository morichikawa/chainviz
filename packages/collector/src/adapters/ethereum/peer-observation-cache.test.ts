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

  it("disables hysteresis entirely when graceTicks is 0 (lower boundary)", () => {
    // graceTicks=0 は「猶予なし」を意味する。lastGood があっても最初の失敗で
    // すぐに fallback を返さない（consecutiveFailures=1 <= 0 が偽）ことを確認する。
    // 猶予境界の下側での off-by-one（0 でも 1 回だけ代用してしまう等）を検出する。
    const cache = new PeerObservationCache(0);
    const observed = nodePeers();
    cache.recordSuccess("chainviz-ethereum/beacon1", observed);

    const r = cache.recordFailure("chainviz-ethereum/beacon1");
    expect(r.consecutiveFailures).toBe(1);
    expect(r.fallback).toBeUndefined();
  });

  it("returns the exact stored observation reference as fallback (no defensive copy)", () => {
    // fallback は toPeerEdges にそのまま渡され通常観測と同一に扱われる想定なので、
    // 保存した参照をそのまま返すこと（余計なコピーやマスクをしていないこと）を
    // 参照同一性で確認する。
    const cache = new PeerObservationCache(3);
    const observed = nodePeers();
    cache.recordSuccess("chainviz-ethereum/beacon1", observed);

    const r = cache.recordFailure("chainviz-ethereum/beacon1");
    expect(r.fallback).toBe(observed);
  });

  it("keeps each node's lastGood and count isolated across interleaved operations", () => {
    // 既存の independence テストは片方が未成功のケースのみ。ここでは両ノードが
    // lastGood を持ち、片方を操作しても他方の lastGood・カウントが一切
    // 汚染されないことを確認する（エントリの取り違えによる退行を検出）。
    const cache = new PeerObservationCache(3);
    const observedA = nodePeers({ stableId: "chainviz-ethereum/beacon1", peerId: "peer-1" });
    const observedB = nodePeers({ stableId: "chainviz-ethereum/beacon2", peerId: "peer-2" });
    cache.recordSuccess("chainviz-ethereum/beacon1", observedA);
    cache.recordSuccess("chainviz-ethereum/beacon2", observedB);

    // beacon2 だけを猶予超過まで失敗させる。
    cache.recordFailure("chainviz-ethereum/beacon2");
    cache.recordFailure("chainviz-ethereum/beacon2");
    cache.recordFailure("chainviz-ethereum/beacon2");
    const b2Exceeded = cache.recordFailure("chainviz-ethereum/beacon2");
    expect(b2Exceeded.consecutiveFailures).toBe(4);
    expect(b2Exceeded.fallback).toBeUndefined();

    // beacon1 は一度も失敗していないので、最初の失敗は count=1・自分の lastGood を
    // 返す（beacon2 の失敗連打に一切引きずられない）。
    const b1First = cache.recordFailure("chainviz-ethereum/beacon1");
    expect(b1First.consecutiveFailures).toBe(1);
    expect(b1First.fallback).toBe(observedA);

    // beacon2 が成功で復帰しても beacon1 のカウントは維持される。
    cache.recordSuccess("chainviz-ethereum/beacon2", observedB);
    const b1Second = cache.recordFailure("chainviz-ethereum/beacon1");
    expect(b1Second.consecutiveFailures).toBe(2);
    expect(b1Second.fallback).toBe(observedA);
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
