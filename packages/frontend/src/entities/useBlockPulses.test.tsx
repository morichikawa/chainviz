import type { BlockEntity } from "@chainviz/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_PULSE_DURATION_MS } from "./blockPulse.js";
import type { PeerFlowEdge } from "./peerEdge.js";
import { useBlockPulses } from "./useBlockPulses.js";

function block(
  hash: string,
  receivedAt: Record<string, number>,
): BlockEntity {
  return {
    kind: "block",
    hash,
    number: 100,
    parentHash: "0xparent",
    timestamp: 1_000,
    receivedAt,
  };
}

function edge(source: string, target: string, id = `peer-${source}-${target}`): PeerFlowEdge {
  return { id, type: "peer", source, target, data: { networkId: "1337" } };
}

/** 保留中のタイマーを進めて、start/end のスケジュールを反映させる。 */
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useBlockPulses", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("starts with no active pulses for a half-received block", () => {
    const now = Date.now();
    const { result } = renderHook(() =>
      useBlockPulses([block("0x1", { a: now })], [edge("a", "b")]),
    );
    advance(1000);
    expect(result.current).toEqual([]);
  });

  it("schedules a pulse once both endpoints have received a fresh block", () => {
    const now = Date.now();
    const edges = [edge("a", "b")];
    const { result, rerender } = renderHook(
      ({ blocks }) => useBlockPulses(blocks, edges),
      { initialProps: { blocks: [block("0x1", { a: now })] } },
    );
    advance(0);
    expect(result.current).toHaveLength(0); // 片側だけ受信

    rerender({ blocks: [block("0x1", { a: now, b: now + 600 })] });
    advance(0); // start タイマー（startDelay 0）を発火
    expect(result.current).toHaveLength(1);
    expect(result.current[0]).toMatchObject({
      edgeId: "peer-a-b",
      reverse: false,
      durationMs: 600,
    });
  });

  it("removes the pulse after its duration elapses", () => {
    const now = Date.now();
    const { result } = renderHook(() =>
      useBlockPulses([block("0x1", { a: now, b: now + 600 })], [edge("a", "b")]),
    );
    advance(0);
    expect(result.current).toHaveLength(1);
    advance(600);
    expect(result.current).toHaveLength(0);
  });

  it("does not re-schedule the same block/edge segment twice", () => {
    const now = Date.now();
    const edges = [edge("a", "b")];
    const { result, rerender } = renderHook(
      ({ blocks }) => useBlockPulses(blocks, edges),
      { initialProps: { blocks: [block("0x1", { a: now, b: now + 600 })] } },
    );
    advance(0);
    expect(result.current).toHaveLength(1);

    // 同じブロックへ別ノードの受信が加わっても、a-b は再発火しない。
    rerender({
      blocks: [block("0x1", { a: now, b: now + 600, c: now + 900 })],
    });
    advance(0);
    expect(result.current.filter((p) => p.edgeId === "peer-a-b")).toHaveLength(1);
  });

  it("ignores stale blocks (e.g. from a reconnect snapshot)", () => {
    const now = Date.now();
    const stale = block("0xold", {
      a: now - 60_000,
      b: now - 60_000 + 600,
    });
    const { result } = renderHook(() =>
      useBlockPulses([stale], [edge("a", "b")]),
    );
    advance(1000);
    expect(result.current).toHaveLength(0);
  });

  it("uses startDelay to stagger segments that arrive in one batch", () => {
    const now = Date.now();
    const edges = [edge("a", "b"), edge("b", "c")];
    // a=t0, b=+500, c=+1000 が1回の更新でまとめて届くケース（差分はフロア超え）。
    const { result } = renderHook(() =>
      useBlockPulses(
        [block("0x1", { a: now, b: now + 500, c: now + 1000 })],
        edges,
      ),
    );
    advance(0);
    // a-b は startDelay 0 → 即時。b-c は startDelay 500 → まだ出ていない。
    expect(result.current.map((p) => p.edgeId)).toEqual(["peer-a-b"]);
    advance(500);
    // t=500 で a-b（所要 500ms）は終了し、b-c が出発する。
    expect(result.current.map((p) => p.edgeId)).toEqual(["peer-b-c"]);
  });

  it("applies the visibility floor to tiny real differences", () => {
    const now = Date.now();
    const { result } = renderHook(() =>
      useBlockPulses([block("0x1", { a: now, b: now + 3 })], [edge("a", "b")]),
    );
    advance(0);
    expect(result.current[0].durationMs).toBe(MIN_PULSE_DURATION_MS);
  });

  it("runs concurrent pulses from two different blocks on the same edge", () => {
    const now = Date.now();
    const edges = [edge("a", "b")];
    const { result } = renderHook(() =>
      useBlockPulses(
        [
          block("0x1", { a: now, b: now + 600 }),
          block("0x2", { a: now, b: now + 600 }),
        ],
        edges,
      ),
    );
    advance(0);
    const onEdge = result.current.filter((p) => p.edgeId === "peer-a-b");
    expect(onEdge).toHaveLength(2);
    expect(new Set(onEdge.map((p) => p.key)).size).toBe(2);
  });

  it("re-schedules a block after it left and re-entered the store", () => {
    const now = Date.now();
    const edges = [edge("a", "b")];
    const { result, rerender } = renderHook(
      ({ blocks }) => useBlockPulses(blocks, edges),
      { initialProps: { blocks: [block("0x1", { a: now, b: now + 600 })] } },
    );
    advance(0);
    expect(result.current).toHaveLength(1);
    advance(600);
    expect(result.current).toHaveLength(0);

    // ブロックが collector の直近ウィンドウから外れて消える。
    rerender({ blocks: [] });
    advance(0);

    // 同じハッシュが再び現れたら、掃除済みなので改めてスケジュールされる。
    const t = Date.now();
    rerender({ blocks: [block("0x1", { a: t, b: t + 600 })] });
    advance(0);
    expect(result.current).toHaveLength(1);
  });

  it("clears pending timers on unmount without firing later state updates", () => {
    const now = Date.now();
    const { result, unmount } = renderHook(() =>
      useBlockPulses([block("0x1", { a: now, b: now + 600 })], [edge("a", "b")]),
    );
    advance(0);
    expect(result.current).toHaveLength(1); // end タイマー待ち
    unmount();
    // タイマーが残っていればアンマウント済みコンポーネントへ setState して警告になる。
    expect(() => advance(5000)).not.toThrow();
  });

  it("emits no pulse on an edge whose endpoint has a NaN receipt time", () => {
    // 有限な受信（a）だけでは方向が確定しないため、a-b にはパルスが出ない
    // （computeBlockPulses が非有限値を未受信として弾く）。
    const now = Date.now();
    const { result } = renderHook(() =>
      useBlockPulses(
        [block("0x1", { a: now, b: Number.NaN })],
        [edge("a", "b")],
      ),
    );
    advance(1000);
    expect(result.current).toHaveLength(0);
  });

  it("does not schedule when edges arrive after the block (deps: blocks only)", () => {
    const now = Date.now();
    const blocks = [block("0x1", { a: now, b: now + 600 })];
    const { result, rerender } = renderHook(
      ({ edges }) => useBlockPulses(blocks, edges),
      { initialProps: { edges: [] as PeerFlowEdge[] } },
    );
    advance(0);
    expect(result.current).toHaveLength(0);
    // エッジが後から届いてもブロック更新が無ければ再計算しない（設計上の制約）。
    rerender({ edges: [edge("a", "b")] });
    advance(0);
    expect(result.current).toHaveLength(0);
  });
});
