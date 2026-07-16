import type { BlockEntity } from "@chainviz/shared";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBlockCadence } from "./useBlockCadence.js";

/** timestamp（秒）とnumberだけを指定してブロックを作る最小限のヘルパー。 */
function block(number: number, timestampSec: number): BlockEntity {
  return {
    kind: "block",
    hash: `0x${number}`,
    number,
    parentHash: `0x${number - 1}`,
    timestamp: timestampSec,
    receivedAt: {},
  };
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("useBlockCadence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("returns null when derivation is not possible (fewer than 2 blocks)", () => {
    const { result } = renderHook(() => useBlockCadence([block(1, Math.floor(Date.now() / 1000))]));
    expect(result.current).toBeNull();
  });

  it("returns a non-null progress once the block set derives a valid cadence", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const blocks = [block(1, nowSec - 24), block(2, nowSec - 12), block(3, nowSec)];
    const { result } = renderHook(() => useBlockCadence(blocks));
    expect(result.current).not.toBeNull();
    expect(result.current?.remainingMs).toBeGreaterThan(0);
    expect(result.current?.remainingMs).toBeLessThanOrEqual(12_000);
  });

  it("counts down as time advances via the tick timer", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const blocks = [block(1, nowSec - 12), block(2, nowSec)];
    const { result } = renderHook(() => useBlockCadence(blocks));
    const initialRemaining = result.current?.remainingMs ?? 0;

    advance(2_000);
    expect(result.current?.remainingMs).toBeLessThan(initialRemaining);
  });

  it("recomputes derivation when the block set changes and reflects the new anchor", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const initialBlocks = [block(1, nowSec - 12), block(2, nowSec)];
    const { result, rerender } = renderHook(
      ({ blocks }: { blocks: BlockEntity[] }) => useBlockCadence(blocks),
      { initialProps: { blocks: initialBlocks } },
    );
    advance(6_000); // 周期の半分程度が経過。
    const midProgress = result.current?.progress ?? 0;
    expect(midProgress).toBeGreaterThan(0.2);

    // 新しいブロックが「今」到着した体（anchor が現在時刻へ更新される）。
    const nextNowSec = Math.floor(Date.now() / 1000);
    const updatedBlocks = [...initialBlocks, block(3, nextNowSec)];
    rerender({ blocks: updatedBlocks });

    // 新しい anchor 直後（今まさに届いたばかり）なので経過率はほぼ0に戻る
    // （中断せずカウントダウンが回り続けるのではなく、新着で位相がリセット
    // される。ARCHITECTURE.md §10.5 のカウントダウン仕様どおり。derived
    // interval の具体的な値には依存しない、progress の相対比較にする）。
    expect(result.current?.progress ?? 1).toBeLessThan(midProgress);
  });

  it("stops updating (no throw) once unmounted mid-countdown", () => {
    const nowSec = Math.floor(Date.now() / 1000);
    const blocks = [block(1, nowSec - 12), block(2, nowSec)];
    const { unmount } = renderHook(() => useBlockCadence(blocks));
    expect(() => {
      unmount();
      advance(5_000);
    }).not.toThrow();
  });
});
