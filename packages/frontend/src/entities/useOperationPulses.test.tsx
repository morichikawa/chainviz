import type { OperationEdge } from "@chainviz/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OPERATION_PULSE_DURATION_MS,
  type OperationSignal,
  operationEdgeId,
} from "./operationEdge.js";
import { useOperationPulses } from "./useOperationPulses.js";

function signal(
  seq: number,
  overrides: Partial<OperationEdge> = {},
): OperationSignal {
  return {
    seq,
    edge: {
      kind: "operation",
      fromWorkbenchId: "workbench-alice",
      toNodeId: "reth-node-1",
      operation: "eth_sendRawTransaction",
      observedAt: 1_000,
      ...overrides,
    },
  };
}

const PRESENT = ["workbench-alice", "reth-node-1", "reth-node-2"];

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useOperationPulses", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("starts with no edges", () => {
    const { result } = renderHook(() => useOperationPulses([], PRESENT));
    expect(result.current).toEqual([]);
  });

  it("creates a temporary edge with a pulse when an operation is observed", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, PRESENT),
      { initialProps: { signals: [] as OperationSignal[] } },
    );
    rerender({ signals: [signal(0)] });
    advance(0);
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({
      id: operationEdgeId("workbench-alice", "reth-node-1"),
      source: "workbench-alice",
      target: "reth-node-1",
    });
    expect(result.current[0].data?.pulses).toHaveLength(1);
  });

  it("removes the edge after the pulse duration elapses", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, PRESENT),
      { initialProps: { signals: [] as OperationSignal[] } },
    );
    rerender({ signals: [signal(0)] });
    advance(0);
    expect(result.current).toHaveLength(1);
    advance(OPERATION_PULSE_DURATION_MS);
    expect(result.current).toHaveLength(0);
  });

  it("ignores an operation whose workbench is not present", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, ["reth-node-1"]),
      { initialProps: { signals: [] as OperationSignal[] } },
    );
    rerender({ signals: [signal(0)] });
    advance(0);
    expect(result.current).toEqual([]);
  });

  it("ignores an operation whose node is not present", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, ["workbench-alice"]),
      { initialProps: { signals: [] as OperationSignal[] } },
    );
    rerender({ signals: [signal(0)] });
    advance(0);
    expect(result.current).toEqual([]);
  });

  it("does not re-animate the same signal seq twice", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, PRESENT),
      { initialProps: { signals: [signal(0)] } },
    );
    advance(0);
    expect(result.current[0].data?.pulses).toHaveLength(1);
    // 同じ seq を含む配列で再レンダーしても二重に走らせない。
    rerender({ signals: [signal(0)] });
    advance(0);
    expect(result.current[0].data?.pulses).toHaveLength(1);
  });

  it("runs concurrent pulses on the same pair for distinct seqs", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, PRESENT),
      { initialProps: { signals: [signal(0)] } },
    );
    advance(0);
    rerender({ signals: [signal(0), signal(1)] });
    advance(0);
    expect(result.current).toHaveLength(1); // 同一ペアなので 1 本のエッジ
    expect(result.current[0].data?.pulses).toHaveLength(2);
  });

  it("creates separate edges for different node targets", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, PRESENT),
      { initialProps: { signals: [] as OperationSignal[] } },
    );
    rerender({
      signals: [signal(0), signal(1, { toNodeId: "reth-node-2" })],
    });
    advance(0);
    expect(result.current).toHaveLength(2);
  });

  it("uses the latest present-id set when a new signal arrives", () => {
    // エッジ集合の変化だけでは再スケジュールしないが、次のイベント到着時には
    // 最新の present 集合を参照する（deps を signals に絞る設計の確認）。
    const { result, rerender } = renderHook(
      ({ signals, present }) => useOperationPulses(signals, present),
      {
        initialProps: {
          signals: [] as OperationSignal[],
          present: ["workbench-alice"] as string[],
        },
      },
    );
    // まだノードが不在 → 無視される。
    rerender({ signals: [signal(0)], present: ["workbench-alice"] });
    advance(0);
    expect(result.current).toEqual([]);
    // ノードが現れてから別のイベントが届くとアニメーションする。
    rerender({ signals: [signal(0), signal(1)], present: PRESENT });
    advance(0);
    expect(result.current).toHaveLength(1);
  });

  it("clears pending timers on unmount without firing later state updates", () => {
    const { result, unmount } = renderHook(() =>
      useOperationPulses([signal(0)], PRESENT),
    );
    advance(0);
    expect(result.current).toHaveLength(1);
    unmount();
    expect(() => advance(5000)).not.toThrow();
  });

  // --- 異常系・境界値の追加テスト（テスト強化） ---

  it("ignores a self-loop operation (from === to)", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, PRESENT),
      { initialProps: { signals: [] as OperationSignal[] } },
    );
    rerender({
      signals: [
        signal(0, { fromWorkbenchId: "reth-node-1", toNodeId: "reth-node-1" }),
      ],
    });
    advance(0);
    expect(result.current).toEqual([]);
  });

  it("ignores an operation when neither endpoint is present", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, []),
      { initialProps: { signals: [] as OperationSignal[] } },
    );
    rerender({ signals: [signal(0)] });
    advance(0);
    expect(result.current).toEqual([]);
  });

  it("does not retry a signal that was ignored due to a missing endpoint", () => {
    // 観測は 1 回きりの seq。端点不在で無視された seq は、その後端点が現れて
    // 同じ seq が再送されても再アニメーションしない（seq を消費済みとして扱う）。
    const { result, rerender } = renderHook(
      ({ signals, present }) => useOperationPulses(signals, present),
      {
        initialProps: {
          signals: [] as OperationSignal[],
          present: ["workbench-alice"] as string[],
        },
      },
    );
    rerender({ signals: [signal(0)], present: ["workbench-alice"] });
    advance(0);
    expect(result.current).toEqual([]);
    // ノードが現れて同じ seq が再送されても無視される。
    rerender({ signals: [signal(0)], present: PRESENT });
    advance(0);
    expect(result.current).toEqual([]);
  });

  it("removes each pulse on its own timer without disturbing the others", () => {
    // 同一ペア上に時間差で複数のパルスが乗る場合、各パルスは自分の
    // タイマーでのみ消え、他のパルスを巻き添えにしない。
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, PRESENT),
      { initialProps: { signals: [signal(0)] } },
    );
    advance(0); // t=0: p0 を 900ms 後に消すタイマー
    expect(result.current[0].data?.pulses).toHaveLength(1);
    advance(100); // t=100
    rerender({ signals: [signal(0), signal(1)] });
    advance(0); // p1 を 1000ms(=100+900) 時点で消すタイマー
    expect(result.current).toHaveLength(1);
    expect(result.current[0].data?.pulses).toHaveLength(2);
    advance(800); // t=900: p0 だけ消える
    expect(result.current).toHaveLength(1);
    expect(result.current[0].data?.pulses).toHaveLength(1);
    expect(result.current[0].data?.pulses[0].key).toBe("op-pulse-1");
    advance(100); // t=1000: p1 も消え、エッジごと消滅
    expect(result.current).toHaveLength(0);
  });

  it("removes staggered pulses on different pairs at their own times", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, PRESENT),
      { initialProps: { signals: [signal(0)] } },
    );
    advance(0); // t=0: node-1 宛のパルス
    advance(450); // t=450
    rerender({ signals: [signal(0), signal(1, { toNodeId: "reth-node-2" })] });
    advance(0); // node-2 宛のパルスを追加
    expect(result.current).toHaveLength(2);
    advance(450); // t=900: node-1 側だけ消える
    expect(result.current).toHaveLength(1);
    expect(result.current[0].target).toBe("reth-node-2");
    advance(450); // t=1350: node-2 側も消える
    expect(result.current).toHaveLength(0);
  });

  it("does not re-create an edge for a seq that already completed", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, PRESENT),
      { initialProps: { signals: [signal(0)] } },
    );
    advance(0);
    expect(result.current).toHaveLength(1);
    advance(OPERATION_PULSE_DURATION_MS);
    expect(result.current).toHaveLength(0);
    // 消費済みの seq を再送しても再生成されない。
    rerender({ signals: [signal(0)] });
    advance(0);
    expect(result.current).toHaveLength(0);
  });

  it("animates a new distinct seq after a previous one completed", () => {
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, PRESENT),
      { initialProps: { signals: [signal(0)] } },
    );
    advance(0);
    advance(OPERATION_PULSE_DURATION_MS);
    expect(result.current).toHaveLength(0);
    // seq=0 は消費済み。新しい seq=1 だけが新規に走る。
    rerender({ signals: [signal(0), signal(1)] });
    advance(0);
    expect(result.current).toHaveLength(1);
    expect(result.current[0].data?.pulses).toHaveLength(1);
    expect(result.current[0].data?.pulses[0].key).toBe("op-pulse-1");
  });

  it("manages many concurrent pulses on the same pair and clears them together", () => {
    const many = Array.from({ length: 50 }, (_, i) => signal(i));
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, PRESENT),
      { initialProps: { signals: [] as OperationSignal[] } },
    );
    rerender({ signals: many });
    advance(0);
    expect(result.current).toHaveLength(1);
    expect(result.current[0].data?.pulses).toHaveLength(50);
    advance(OPERATION_PULSE_DURATION_MS);
    expect(result.current).toHaveLength(0);
  });

  it("does not schedule duplicate timers when re-rendered repeatedly before the pulse ends", () => {
    // 同一 signals での再レンダーを繰り返してもパルスは 1 本のまま増えず、
    // 満了時に 1 回だけ消える（二重スケジュールによるタイマーリークがない）。
    const { result, rerender } = renderHook(
      ({ signals }) => useOperationPulses(signals, PRESENT),
      { initialProps: { signals: [signal(0)] } },
    );
    advance(0);
    for (let i = 0; i < 5; i++) {
      rerender({ signals: [signal(0)] });
      advance(100);
    }
    // t=500: まだ満了前。パルスは 1 本のまま。
    expect(result.current).toHaveLength(1);
    expect(result.current[0].data?.pulses).toHaveLength(1);
    advance(400); // t=900: 満了
    expect(result.current).toHaveLength(0);
  });

  it("does not throw when unmounted after a pulse has already been removed", () => {
    const { result, unmount } = renderHook(() =>
      useOperationPulses([signal(0)], PRESENT),
    );
    advance(0);
    advance(OPERATION_PULSE_DURATION_MS);
    expect(result.current).toHaveLength(0);
    expect(() => unmount()).not.toThrow();
    expect(() => advance(5000)).not.toThrow();
  });
});
