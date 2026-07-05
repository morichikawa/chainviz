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
});
