import type { BlockEntity } from "@chainviz/shared";
import { describe, expect, it } from "vitest";
import {
  type ActivePulse,
  DEFAULT_FRESHNESS_MS,
  MIN_PULSE_DURATION_MS,
  attachPulsesToEdges,
  computeBlockPulses,
  isFreshBlock,
  latestReceiptTime,
  pulseSeenKey,
  waveOriginTime,
} from "./blockPulse.js";
import type { PeerFlowEdge } from "./peerEdge.js";

function block(receivedAt: Record<string, number>): BlockEntity {
  return {
    kind: "block",
    hash: "0xabc",
    number: 100,
    parentHash: "0xdef",
    timestamp: 1_000,
    receivedAt,
  };
}

/** flow edge の最小形（source=小, target=大 に正規化済みの前提）。 */
function edge(source: string, target: string, id = `peer-${source}-${target}`): PeerFlowEdge {
  return {
    id,
    type: "peer",
    source,
    target,
    data: { networkId: "1337" },
  };
}

describe("waveOriginTime", () => {
  it("returns the earliest receipt time", () => {
    expect(waveOriginTime(block({ a: 1005, b: 1002, c: 1009 }))).toBe(1002);
  });

  it("returns null when no node has received the block", () => {
    expect(waveOriginTime(block({}))).toBeNull();
  });

  it("handles a single receipt", () => {
    expect(waveOriginTime(block({ a: 1005 }))).toBe(1005);
  });

  it("handles negative epoch offsets as ordinary numbers", () => {
    expect(waveOriginTime(block({ a: -200, b: -50 }))).toBe(-200);
  });

  it("ignores non-finite receipt times (NaN / Infinity)", () => {
    // collector は Date.now() 由来のため通常起きないが、純粋関数の契約として
    // 有限数でない値は「未受信」として無視する（min を NaN で汚染させない）。
    expect(waveOriginTime(block({ a: Number.NaN, b: 1000 }))).toBe(1000);
    expect(
      waveOriginTime(block({ a: Number.NEGATIVE_INFINITY, b: 1000 })),
    ).toBe(1000);
    expect(waveOriginTime(block({ a: Number.NaN }))).toBeNull();
  });
});

describe("latestReceiptTime", () => {
  it("returns the latest receipt time", () => {
    expect(latestReceiptTime(block({ a: 1005, b: 1002, c: 1009 }))).toBe(1009);
  });

  it("returns null when empty", () => {
    expect(latestReceiptTime(block({}))).toBeNull();
  });

  it("handles a single receipt", () => {
    expect(latestReceiptTime(block({ a: 1005 }))).toBe(1005);
  });

  it("ignores non-finite receipt times (NaN / Infinity)", () => {
    expect(latestReceiptTime(block({ a: 1000, b: Number.NaN }))).toBe(1000);
    expect(
      latestReceiptTime(block({ a: 1000, b: Number.POSITIVE_INFINITY })),
    ).toBe(1000);
    expect(latestReceiptTime(block({ a: Number.NaN }))).toBeNull();
  });
});

describe("isFreshBlock", () => {
  it("is fresh when the latest receipt is within the window", () => {
    const b = block({ a: 1000, b: 1100 });
    expect(isFreshBlock(b, 1100 + DEFAULT_FRESHNESS_MS - 1)).toBe(true);
  });

  it("is stale when the latest receipt is older than the window", () => {
    const b = block({ a: 1000, b: 1100 });
    expect(isFreshBlock(b, 1100 + DEFAULT_FRESHNESS_MS + 1)).toBe(false);
  });

  it("is never fresh when no node has received the block", () => {
    expect(isFreshBlock(block({}), 1000)).toBe(false);
  });

  it("respects a custom window", () => {
    const b = block({ a: 1000 });
    expect(isFreshBlock(b, 1500, 400)).toBe(false);
    expect(isFreshBlock(b, 1300, 400)).toBe(true);
  });

  it("treats a future receipt (clock skew) as fresh", () => {
    expect(isFreshBlock(block({ a: 2000 }), 1000)).toBe(true);
  });

  it("treats the exact freshness boundary as fresh (inclusive)", () => {
    const b = block({ a: 1000, b: 1100 });
    expect(isFreshBlock(b, 1100 + DEFAULT_FRESHNESS_MS)).toBe(true);
  });

  it("with a zero window only the exact receipt instant is fresh", () => {
    const b = block({ a: 1000 });
    expect(isFreshBlock(b, 1000, 0)).toBe(true);
    expect(isFreshBlock(b, 1001, 0)).toBe(false);
  });

  it("keys off receipt time, not block.timestamp", () => {
    // timestamp が古くても、判定は最新受信時刻だけを見る。
    const b: BlockEntity = { ...block({ a: 5000 }), timestamp: 1 };
    expect(isFreshBlock(b, 5000)).toBe(true);
  });

  it("judges freshness from finite receipt times only", () => {
    // 有限数でない受信時刻は「未受信」扱い。全て非有限なら stale、有限な受信が
    // 1つでも鮮度ウィンドウ内なら fresh（波は有限な受信だけで描かれる）。
    expect(isFreshBlock(block({ a: Number.NaN }), 1000)).toBe(false);
    expect(isFreshBlock(block({ a: 1000, b: Number.NaN }), 1000)).toBe(true);
    expect(
      isFreshBlock(
        block({ a: 1000, b: Number.NaN }),
        1000 + DEFAULT_FRESHNESS_MS + 1,
      ),
    ).toBe(false);
  });
});

describe("computeBlockPulses", () => {
  it("returns no pulses for an unreceived block", () => {
    expect(computeBlockPulses(block({}), [edge("a", "b")])).toEqual([]);
  });

  it("skips edges where only one endpoint has received the block", () => {
    expect(computeBlockPulses(block({ a: 1000 }), [edge("a", "b")])).toEqual([]);
  });

  it("emits a forward pulse when the source received earlier", () => {
    const segments = computeBlockPulses(
      block({ a: 1000, b: 1600 }),
      [edge("a", "b")],
    );
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      edgeId: "peer-a-b",
      fromNodeId: "a",
      toNodeId: "b",
      reverse: false,
      startDelayMs: 0,
      durationMs: 600, // real diff, above the floor
    });
  });

  it("emits a reverse pulse when the target received earlier", () => {
    const segments = computeBlockPulses(
      block({ a: 1600, b: 1000 }),
      [edge("a", "b")],
    );
    expect(segments[0]).toMatchObject({
      fromNodeId: "b",
      toNodeId: "a",
      reverse: true,
      startDelayMs: 0,
      durationMs: 600,
    });
  });

  it("applies the minimum-duration floor when the real diff is tiny", () => {
    // 実環境で起きうる数 ms 差。フロアまで引き上げる。
    const segments = computeBlockPulses(
      block({ a: 1000, b: 1003 }),
      [edge("a", "b")],
    );
    expect(segments[0].durationMs).toBe(MIN_PULSE_DURATION_MS);
  });

  it("uses the real diff verbatim when it exceeds the floor", () => {
    // 将来 tc netem で数百 ms の遅延が入ったケース。実差分をそのまま使う。
    const segments = computeBlockPulses(
      block({ a: 1000, b: 1000 + MIN_PULSE_DURATION_MS + 300 }),
      [edge("a", "b")],
    );
    expect(segments[0].durationMs).toBe(MIN_PULSE_DURATION_MS + 300);
  });

  it("uses the floor on an exact tie and keeps forward direction", () => {
    const segments = computeBlockPulses(
      block({ a: 1000, b: 1000 }),
      [edge("a", "b")],
    );
    expect(segments[0].reverse).toBe(false);
    expect(segments[0].durationMs).toBe(MIN_PULSE_DURATION_MS);
  });

  it("honors a custom minimum duration", () => {
    const segments = computeBlockPulses(
      block({ a: 1000, b: 1002 }),
      [edge("a", "b")],
      { minDurationMs: 800 },
    );
    expect(segments[0].durationMs).toBe(800);
  });

  it("computes startDelay relative to the wave origin (t0)", () => {
    // t0 = 1000 (a). エッジ b-c は先発が b(1200) なので出発遅延 200ms。
    const segments = computeBlockPulses(
      block({ a: 1000, b: 1200, c: 1700 }),
      [edge("b", "c")],
    );
    expect(segments[0]).toMatchObject({
      fromNodeId: "b",
      toNodeId: "c",
      startDelayMs: 200,
      durationMs: 500,
    });
  });

  it("builds a wave across a triangle with correct order and timing", () => {
    // a が起点、0.6s 後に b、1.2s 後に c が受信（いずれもフロア超え）。全ペア接続。
    const segments = computeBlockPulses(
      block({ a: 1000, b: 1600, c: 2200 }),
      [edge("a", "b"), edge("a", "c"), edge("b", "c")],
    );
    // edgeId 昇順に安定ソートされる。
    expect(segments.map((s) => s.edgeId)).toEqual([
      "peer-a-b",
      "peer-a-c",
      "peer-b-c",
    ]);
    const byId = new Map(segments.map((s) => [s.edgeId, s]));
    expect(byId.get("peer-a-b")).toMatchObject({ startDelayMs: 0, durationMs: 600 });
    expect(byId.get("peer-a-c")).toMatchObject({ startDelayMs: 0, durationMs: 1200 });
    expect(byId.get("peer-b-c")).toMatchObject({ startDelayMs: 600, durationMs: 600 });
  });

  it("sorts output deterministically by edgeId", () => {
    const segments = computeBlockPulses(
      block({ a: 1000, b: 1100, c: 1200 }),
      [edge("b", "c", "z-edge"), edge("a", "b", "a-edge")],
    );
    expect(segments.map((s) => s.edgeId)).toEqual(["a-edge", "z-edge"]);
  });

  it("emits no pulses when no edge connects the receiving nodes", () => {
    // a と b は受信済みだがエッジは無関係な c-d のみ。
    expect(
      computeBlockPulses(block({ a: 1000, b: 2000 }), [edge("c", "d")]),
    ).toEqual([]);
  });

  it("skips ineligible edges while emitting eligible ones", () => {
    const segments = computeBlockPulses(
      block({ a: 1000, b: 1600, c: 2000 }),
      [edge("a", "b"), edge("c", "d")], // c-d は d 未受信で対象外
    );
    expect(segments.map((s) => s.edgeId)).toEqual(["peer-a-b"]);
  });

  it("ignores receiving nodes that share no edge with the wave", () => {
    // d は受信しているがエッジが無い → 波に寄与しない。
    const segments = computeBlockPulses(
      block({ a: 1000, b: 1600, d: 1200 }),
      [edge("a", "b")],
    );
    expect(segments).toHaveLength(1);
  });

  it("uses the floor at exactly the floor boundary", () => {
    const segments = computeBlockPulses(
      block({ a: 1000, b: 1000 + MIN_PULSE_DURATION_MS }),
      [edge("a", "b")],
    );
    expect(segments[0].durationMs).toBe(MIN_PULSE_DURATION_MS);
  });

  it("raises a just-below-floor diff up to the floor", () => {
    const segments = computeBlockPulses(
      block({ a: 1000, b: 1000 + MIN_PULSE_DURATION_MS - 1 }),
      [edge("a", "b")],
    );
    expect(segments[0].durationMs).toBe(MIN_PULSE_DURATION_MS);
  });

  it("keeps startDelay non-negative and reverse for a delayed reverse edge", () => {
    // t0 = a(1000). エッジ b-c は c(1200) が先、b(1700) が後 → 逆走 + 出発遅延 200。
    const segments = computeBlockPulses(
      block({ a: 1000, b: 1700, c: 1200 }),
      [edge("b", "c")],
    );
    expect(segments[0]).toMatchObject({
      fromNodeId: "c",
      toNodeId: "b",
      reverse: true,
      startDelayMs: 200,
      durationMs: 500,
    });
  });

  it("handles negative epoch offsets as ordinary numbers", () => {
    const segments = computeBlockPulses(
      block({ a: -1000, b: 0 }),
      [edge("a", "b")],
    );
    expect(segments[0]).toMatchObject({
      fromNodeId: "a",
      toNodeId: "b",
      startDelayMs: 0,
      durationMs: 1000,
    });
  });

  it("treats non-finite receipt times as unreceived and skips the edge", () => {
    // NaN / Infinity が durationMs へ伝播して dur="NaNms" にならないよう、
    // 有限数でない受信時刻を持つ端点は未受信として扱う。
    expect(
      computeBlockPulses(block({ a: Number.NaN, b: 1000 }), [edge("a", "b")]),
    ).toEqual([]);
    expect(
      computeBlockPulses(block({ a: Number.POSITIVE_INFINITY, b: 1000 }), [
        edge("a", "b"),
      ]),
    ).toEqual([]);
  });

  it("still emits pulses on healthy edges when another receipt is non-finite", () => {
    // b の受信時刻が壊れていても、a-c の波は有限な実データだけで描かれる。
    const segments = computeBlockPulses(
      block({ a: 1000, b: Number.NaN, c: 1600 }),
      [edge("a", "b"), edge("a", "c")],
    );
    expect(segments.map((s) => s.edgeId)).toEqual(["peer-a-c"]);
    expect(segments[0].durationMs).toBe(600);
  });
});

describe("pulseSeenKey", () => {
  it("combines hash and edge id", () => {
    expect(pulseSeenKey("0xabc", "peer-a-b")).toBe("0xabc::peer-a-b");
  });
});

describe("attachPulsesToEdges", () => {
  const pulse = (edgeId: string, key: string): ActivePulse => ({
    edgeId,
    key,
    reverse: false,
    durationMs: 500,
  });

  it("attaches pulses to the matching edge only", () => {
    const edges = [edge("a", "b", "e1"), edge("c", "d", "e2")];
    const result = attachPulsesToEdges(edges, [pulse("e1", "k1")]);
    expect(result[0].data?.pulses).toEqual([
      { key: "k1", reverse: false, durationMs: 500 },
    ]);
    expect(result[1].data?.pulses).toBeUndefined();
  });

  it("groups multiple pulses onto the same edge", () => {
    const edges = [edge("a", "b", "e1")];
    const result = attachPulsesToEdges(edges, [
      pulse("e1", "k1"),
      pulse("e1", "k2"),
    ]);
    expect(result[0].data?.pulses).toHaveLength(2);
  });

  it("keeps the original edge reference when nothing changes", () => {
    const edges = [edge("a", "b", "e1")];
    const result = attachPulsesToEdges(edges, []);
    expect(result[0]).toBe(edges[0]);
  });

  it("clears stale pulses from an edge that no longer has active pulses", () => {
    const withPulses = attachPulsesToEdges([edge("a", "b", "e1")], [
      pulse("e1", "k1"),
    ]);
    const cleared = attachPulsesToEdges(withPulses, []);
    expect(cleared[0].data?.pulses).toBeUndefined();
    // data 参照は作り直される（元と別オブジェクト）。
    expect(cleared[0]).not.toBe(withPulses[0]);
  });

  it("preserves networkId when attaching pulses", () => {
    const result = attachPulsesToEdges([edge("a", "b", "e1")], [
      pulse("e1", "k1"),
    ]);
    expect(result[0].data?.networkId).toBe("1337");
  });

  it("returns an empty array for no edges", () => {
    expect(attachPulsesToEdges([], [pulse("e1", "k1")])).toEqual([]);
  });

  it("drops pulses whose edge is not present and keeps references", () => {
    const edges = [edge("a", "b", "e1")];
    const result = attachPulsesToEdges(edges, [pulse("e2", "k1")]);
    expect(result[0]).toBe(edges[0]); // 変化なし → 参照維持
    expect(result[0].data?.pulses).toBeUndefined();
  });

  it("attaches pulses from different blocks onto the same edge", () => {
    const edges = [edge("a", "b", "e1")];
    const result = attachPulsesToEdges(edges, [
      pulse("e1", "0xAAA::e1#0"),
      pulse("e1", "0xBBB::e1#1"),
    ]);
    expect(result[0].data?.pulses).toHaveLength(2);
    const keys = result[0].data?.pulses?.map((p) => p.key);
    expect(new Set(keys).size).toBe(2);
  });
});
