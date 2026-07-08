import type { NodeLinkActivity } from "@chainviz/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INTERNAL_LINK_PULSE_DURATION_MS,
  type InternalLinkFlowEdge,
  type NodeLinkActivitySignal,
  internalLinkEdgeId,
} from "./internalLinkEdge.js";
import { useNodeLinkActivityPulses } from "./useNodeLinkActivityPulses.js";

function baseEdge(): InternalLinkFlowEdge {
  return {
    id: internalLinkEdgeId("beacon-1", "reth-1"),
    type: "internalLink",
    source: "beacon-1",
    target: "reth-1",
    data: {
      drivingContainerName: "chainviz-lighthouse-1",
      drivenContainerName: "chainviz-reth-1",
    },
  };
}

function baseEdgeB(): InternalLinkFlowEdge {
  return {
    id: internalLinkEdgeId("beacon-2", "reth-2"),
    type: "internalLink",
    source: "beacon-2",
    target: "reth-2",
    data: {
      drivingContainerName: "chainviz-lighthouse-2",
      drivenContainerName: "chainviz-reth-2",
    },
  };
}

function signal(
  seq: number,
  overrides: Partial<NodeLinkActivity> = {},
): NodeLinkActivitySignal {
  return {
    seq,
    activity: {
      fromNodeId: "beacon-1",
      toNodeId: "reth-1",
      calls: [{ method: "engine_newPayloadV4", count: 2 }],
      observedAt: 1_000,
      ...overrides,
    },
  };
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useNodeLinkActivityPulses", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("returns the base edges unchanged (no pulses) when there are no signals", () => {
    const { result } = renderHook(() => useNodeLinkActivityPulses([], [baseEdge()]));
    expect(result.current).toHaveLength(1);
    expect(result.current[0].data?.pulses).toBeUndefined();
    expect(result.current[0].data?.lastActivity).toBeUndefined();
  });

  it("attaches a pulse and the last activity to the matching permanent edge", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, [baseEdge()]),
      { initialProps: { signals: [] as NodeLinkActivitySignal[] } },
    );
    rerender({ signals: [signal(0)] });
    advance(0);
    expect(result.current).toHaveLength(1); // 常設エッジなので本数は増えない
    expect(result.current[0].data?.pulses).toHaveLength(1);
    expect(result.current[0].data?.lastActivity).toEqual({
      calls: [{ method: "engine_newPayloadV4", count: 2 }],
      observedAt: 1_000,
    });
  });

  it("removes the pulse after its duration, but keeps the edge and the last activity", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, [baseEdge()]),
      { initialProps: { signals: [] as NodeLinkActivitySignal[] } },
    );
    rerender({ signals: [signal(0)] });
    advance(0);
    expect(result.current[0].data?.pulses).toHaveLength(1);
    advance(INTERNAL_LINK_PULSE_DURATION_MS);
    expect(result.current).toHaveLength(1); // 常設エッジ自体は消えない
    expect(result.current[0].data?.pulses).toBeUndefined();
    expect(result.current[0].data?.lastActivity).toBeDefined();
  });

  it("ignores an activity whose edge is not present (dangling guard)", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, []),
      { initialProps: { signals: [] as NodeLinkActivitySignal[] } },
    );
    rerender({ signals: [signal(0)] });
    advance(0);
    expect(result.current).toEqual([]);
  });

  it("does not re-animate the same signal seq twice", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, [baseEdge()]),
      { initialProps: { signals: [signal(0)] } },
    );
    advance(0);
    expect(result.current[0].data?.pulses).toHaveLength(1);
    rerender({ signals: [signal(0)] });
    advance(0);
    expect(result.current[0].data?.pulses).toHaveLength(1);
  });

  it("runs concurrent pulses on the same edge for distinct seqs", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, [baseEdge()]),
      { initialProps: { signals: [signal(0)] } },
    );
    advance(0);
    rerender({ signals: [signal(0), signal(1)] });
    advance(0);
    expect(result.current[0].data?.pulses).toHaveLength(2);
  });

  it("overwrites lastActivity with the most recent observation", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, [baseEdge()]),
      { initialProps: { signals: [] as NodeLinkActivitySignal[] } },
    );
    rerender({ signals: [signal(0, { observedAt: 1_000 })] });
    advance(0);
    rerender({
      signals: [
        signal(0, { observedAt: 1_000 }),
        signal(1, {
          observedAt: 4_000,
          calls: [{ method: "engine_forkchoiceUpdatedV3", count: 1 }],
        }),
      ],
    });
    advance(0);
    expect(result.current[0].data?.lastActivity).toEqual({
      calls: [{ method: "engine_forkchoiceUpdatedV3", count: 1 }],
      observedAt: 4_000,
    });
  });

  it("uses the latest base edge set when a new signal arrives (edge appearing later)", () => {
    const { result, rerender } = renderHook(
      ({ signals, edges }) => useNodeLinkActivityPulses(signals, edges),
      {
        initialProps: {
          signals: [] as NodeLinkActivitySignal[],
          edges: [] as InternalLinkFlowEdge[],
        },
      },
    );
    // まだエッジが無い → 無視される。
    rerender({ signals: [signal(0)], edges: [] });
    advance(0);
    expect(result.current).toEqual([]);
    // エッジが現れてから別のイベントが届くとパルスが乗る。
    rerender({ signals: [signal(0), signal(1)], edges: [baseEdge()] });
    advance(0);
    expect(result.current[0].data?.pulses).toHaveLength(1);
  });

  it("routes each activity to its own edge when multiple edges coexist (no pulse cross-contamination)", () => {
    const edges = [baseEdge(), baseEdgeB()];
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, edges),
      { initialProps: { signals: [] as NodeLinkActivitySignal[] } },
    );
    // edge A (beacon-1=>reth-1) にだけ観測が来る。
    rerender({ signals: [signal(0)] });
    advance(0);
    const aOnly = result.current;
    expect(aOnly.find((e) => e.source === "beacon-1")?.data?.pulses).toHaveLength(1);
    expect(aOnly.find((e) => e.source === "beacon-2")?.data?.pulses).toBeUndefined();
    expect(aOnly.find((e) => e.source === "beacon-2")?.data?.lastActivity).toBeUndefined();
    // edge B (beacon-2=>reth-2) への観測を追加。A のパルスは残り、B に別途乗る。
    // observedAt を変えて、直近観測が取り違えられていないことを検証できるようにする。
    rerender({
      signals: [
        signal(0),
        signal(1, { fromNodeId: "beacon-2", toNodeId: "reth-2", observedAt: 7_000 }),
      ],
    });
    advance(0);
    const both = result.current;
    expect(both.find((e) => e.source === "beacon-1")?.data?.pulses).toHaveLength(1);
    expect(both.find((e) => e.source === "beacon-2")?.data?.pulses).toHaveLength(1);
    // 直近観測もエッジごとに独立して保持される（混線しない）。
    expect(both.find((e) => e.source === "beacon-1")?.data?.lastActivity?.observedAt).toBe(1_000);
    expect(both.find((e) => e.source === "beacon-2")?.data?.lastActivity?.observedAt).toBe(7_000);
  });

  it("permanently drops a signal observed while its edge was absent (same seq does not re-fire once the edge appears)", () => {
    // 新着ノードの発光と同時に観測が届き、まだ内部リンクエッジが無い場合。
    // §7.6.4「端点がキャンバスに無い観測は無視」。取りこぼしはリカバリせず、
    // 同じ seq を再度渡してもエッジ出現後に遡って発火はしない（seen 済み）。
    const { result, rerender } = renderHook(
      ({ signals, edges }) => useNodeLinkActivityPulses(signals, edges),
      {
        initialProps: {
          signals: [] as NodeLinkActivitySignal[],
          edges: [] as InternalLinkFlowEdge[],
        },
      },
    );
    rerender({ signals: [signal(0)], edges: [] });
    advance(0);
    rerender({ signals: [signal(0)], edges: [baseEdge()] });
    advance(0);
    expect(result.current[0].data?.pulses).toBeUndefined();
    expect(result.current[0].data?.lastActivity).toBeUndefined();
  });

  it("still emits one pulse for an observation with an empty calls array (heartbeat semantics)", () => {
    // 実運用では collector が calls 空の観測を送らない（送信前に length===0 で
    // 打ち切る）ため通常は起こらないが、フロント側が防御的にどう振る舞うかを
    // 固定する。1観測=1パルスの原則どおり、calls が空でもパルスは1本出す。
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, [baseEdge()]),
      { initialProps: { signals: [] as NodeLinkActivitySignal[] } },
    );
    rerender({ signals: [signal(0, { calls: [] })] });
    advance(0);
    expect(result.current[0].data?.pulses).toHaveLength(1);
    expect(result.current[0].data?.lastActivity).toEqual({ calls: [], observedAt: 1_000 });
  });

  it("clears pending timers on unmount without firing later state updates", () => {
    const { result, unmount } = renderHook(() =>
      useNodeLinkActivityPulses([signal(0)], [baseEdge()]),
    );
    advance(0);
    expect(result.current[0].data?.pulses).toHaveLength(1);
    unmount();
    expect(() => advance(5000)).not.toThrow();
  });

  it("removes each pulse on its own timer without disturbing the others", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useNodeLinkActivityPulses(signals, [baseEdge()]),
      { initialProps: { signals: [signal(0)] } },
    );
    advance(0);
    advance(100);
    rerender({ signals: [signal(0), signal(1)] });
    advance(0);
    expect(result.current[0].data?.pulses).toHaveLength(2);
    advance(800); // t=900: 最初のパルスだけ消える
    expect(result.current[0].data?.pulses).toHaveLength(1);
    expect(result.current[0].data?.pulses?.[0].key).toBe("internal-link-pulse-1");
    advance(100); // t=1000: 2本目も消えるが、エッジ自体は残る
    expect(result.current).toHaveLength(1);
    expect(result.current[0].data?.pulses).toBeUndefined();
  });
});
