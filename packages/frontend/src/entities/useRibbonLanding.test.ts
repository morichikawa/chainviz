import type { BlockEntity } from "@chainviz/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ChainRibbonTile } from "./chainRibbon.js";
import { RIBBON_LANDING_DURATION_MS, useRibbonLanding } from "./useRibbonLanding.js";

function tile(
  hash: string,
  receivedAtOffset: number,
  connectedToPrevious = true,
): ChainRibbonTile {
  const block: BlockEntity = {
    kind: "block",
    hash,
    number: 100,
    parentHash: "0xparent",
    timestamp: 1_000,
    receivedAt: { n1: Date.now() - receivedAtOffset },
  };
  return { block, connectedToPrevious };
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useRibbonLanding", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("does not animate the initial tile set (baseline established on first render)", () => {
    const { result } = renderHook(() => useRibbonLanding([tile("0x1", 0)]));
    expect(result.current.size).toBe(0);
  });

  it("marks a newly-arrived fresh tile as landing", () => {
    const { result, rerender } = renderHook(
      ({ tiles }: { tiles: ChainRibbonTile[] }) => useRibbonLanding(tiles),
      { initialProps: { tiles: [tile("0x1", 0)] } },
    );
    rerender({ tiles: [tile("0x1", 0), tile("0x2", 0)] });
    expect(result.current.has("0x2")).toBe(true);
    expect(result.current.has("0x1")).toBe(false);
  });

  it("does not animate a newly-appearing tile whose block is stale (reconnect burst)", () => {
    const { result, rerender } = renderHook(
      ({ tiles }: { tiles: ChainRibbonTile[] }) => useRibbonLanding(tiles),
      { initialProps: { tiles: [] as ChainRibbonTile[] } },
    );
    // receivedAt はかなり過去（isFreshBlock の既定閾値6000msより古い）。
    rerender({ tiles: [tile("0x1", 60_000)] });
    expect(result.current.size).toBe(0);
  });

  it("clears the landing flag after RIBBON_LANDING_DURATION_MS", () => {
    const { result, rerender } = renderHook(
      ({ tiles }: { tiles: ChainRibbonTile[] }) => useRibbonLanding(tiles),
      { initialProps: { tiles: [] as ChainRibbonTile[] } },
    );
    rerender({ tiles: [tile("0x1", 0)] });
    expect(result.current.has("0x1")).toBe(true);

    advance(RIBBON_LANDING_DURATION_MS - 1);
    expect(result.current.has("0x1")).toBe(true);
    advance(1);
    expect(result.current.has("0x1")).toBe(false);
  });

  it("times multiple staggered arrivals independently", () => {
    const { result, rerender } = renderHook(
      ({ tiles }: { tiles: ChainRibbonTile[] }) => useRibbonLanding(tiles),
      { initialProps: { tiles: [] as ChainRibbonTile[] } },
    );
    rerender({ tiles: [tile("0x1", 0)] });
    advance(RIBBON_LANDING_DURATION_MS / 2);
    rerender({ tiles: [tile("0x1", 0), tile("0x2", 0)] });

    expect(result.current.has("0x1")).toBe(true);
    expect(result.current.has("0x2")).toBe(true);

    advance(RIBBON_LANDING_DURATION_MS / 2);
    expect(result.current.has("0x1")).toBe(false);
    expect(result.current.has("0x2")).toBe(true);

    advance(RIBBON_LANDING_DURATION_MS / 2);
    expect(result.current.has("0x2")).toBe(false);
  });

  it("does not throw when a landing tile disappears before its timer fires", () => {
    const { result, rerender } = renderHook(
      ({ tiles }: { tiles: ChainRibbonTile[] }) => useRibbonLanding(tiles),
      { initialProps: { tiles: [] as ChainRibbonTile[] } },
    );
    rerender({ tiles: [tile("0x1", 0)] });
    expect(result.current.has("0x1")).toBe(true);

    expect(() => rerender({ tiles: [] })).not.toThrow();
    expect(() => advance(RIBBON_LANDING_DURATION_MS)).not.toThrow();
  });

  it("cleans up pending timers on unmount without throwing", () => {
    const { rerender, unmount } = renderHook(
      ({ tiles }: { tiles: ChainRibbonTile[] }) => useRibbonLanding(tiles),
      { initialProps: { tiles: [] as ChainRibbonTile[] } },
    );
    rerender({ tiles: [tile("0x1", 0)] });
    expect(() => {
      unmount();
      advance(RIBBON_LANDING_DURATION_MS);
    }).not.toThrow();
  });
});
