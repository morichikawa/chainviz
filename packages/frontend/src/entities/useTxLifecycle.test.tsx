import type { TransactionEntity } from "@chainviz/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TX_SETTLE_FLASH_MS, useTxLifecycle } from "./useTxLifecycle.js";

function tx(
  hash: string,
  status: TransactionEntity["status"],
): TransactionEntity {
  return { kind: "transaction", hash, from: "0xa", to: "0xb", status };
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useTxLifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("starts empty for a newly pending tx", () => {
    const { result } = renderHook(() => useTxLifecycle([tx("0x1", "pending")]));
    advance(0);
    expect([...result.current]).toEqual([]);
  });

  it("flags a tx that transitions pending → included", () => {
    const { result, rerender } = renderHook(
      ({ txs }) => useTxLifecycle(txs),
      { initialProps: { txs: [tx("0x1", "pending")] } },
    );
    advance(0);
    rerender({ txs: [tx("0x1", "included")] });
    advance(0);
    expect([...result.current]).toEqual(["0x1"]);
  });

  it("clears the flag after the flash duration", () => {
    const { result, rerender } = renderHook(
      ({ txs }) => useTxLifecycle(txs),
      { initialProps: { txs: [tx("0x1", "pending")] } },
    );
    advance(0);
    rerender({ txs: [tx("0x1", "included")] });
    advance(0);
    expect(result.current.has("0x1")).toBe(true);
    advance(TX_SETTLE_FLASH_MS);
    expect(result.current.has("0x1")).toBe(false);
  });

  it("flags a pending → failed transition too", () => {
    const { result, rerender } = renderHook(
      ({ txs }) => useTxLifecycle(txs),
      { initialProps: { txs: [tx("0x1", "pending")] } },
    );
    advance(0);
    rerender({ txs: [tx("0x1", "failed")] });
    advance(0);
    expect(result.current.has("0x1")).toBe(true);
  });

  it("does not flag a tx that appears already included", () => {
    const { result } = renderHook(() =>
      useTxLifecycle([tx("0x1", "included")]),
    );
    advance(0);
    expect([...result.current]).toEqual([]);
  });

  it("clears pending timers on unmount without throwing", () => {
    const { rerender, unmount } = renderHook(
      ({ txs }) => useTxLifecycle(txs),
      { initialProps: { txs: [tx("0x1", "pending")] } },
    );
    advance(0);
    rerender({ txs: [tx("0x1", "included")] });
    advance(0);
    unmount();
    expect(() => advance(TX_SETTLE_FLASH_MS * 2)).not.toThrow();
  });
});
